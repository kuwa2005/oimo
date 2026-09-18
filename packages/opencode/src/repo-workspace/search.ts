import path from "path"
import { Effect, Option } from "effect"
import * as Stream from "effect/Stream"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { Ripgrep } from "@/file/ripgrep"
import type { Info } from "./schema"
import { formatLocation, locate, rootOf } from "./resolve"

export type CrossMatch = {
  repositoryId: string
  relativePath: string
  absolutePath: string
  line: number
  text: string
}

/**
 * Read-only search across registered repositories.
 * Caps results so callers do not dump unbounded matches into the LLM.
 */
export function searchAcross(
  info: Info,
  input: {
    pattern: string
    repositoryIds?: string[]
    include?: string
    signal?: AbortSignal
    limit?: number
  },
) {
  return Effect.gen(function* () {
    const rg = yield* Ripgrep.Service
    const ids = input.repositoryIds?.length ? input.repositoryIds : [...info.repositories.keys()]
    const limit = input.limit ?? 100
    const matches: CrossMatch[] = []

    for (const id of ids) {
      const repo = rootOf(info, id)
      const result = yield* rg.search({
        cwd: repo.canonicalPath,
        pattern: input.pattern,
        glob: input.include ? [input.include] : undefined,
        signal: input.signal,
      })
      for (const item of result.items) {
        const absolutePath = AppFileSystem.resolve(
          path.isAbsolute(item.path.text) ? item.path.text : path.join(repo.canonicalPath, item.path.text),
        )
        const hit = locate(info, absolutePath)
        if (!hit || hit.repository.id !== id) continue
        matches.push({
          repositoryId: id,
          relativePath: hit.location.relativePath,
          absolutePath,
          line: item.line_number,
          text: item.lines.text,
        })
        if (matches.length >= limit) return { matches, truncated: true as const }
      }
    }
    return { matches, truncated: false as const }
  })
}

export function formatMatches(matches: CrossMatch[]) {
  return matches
    .map(
      (m) =>
        `${formatLocation({ repositoryId: m.repositoryId, relativePath: m.relativePath })}:${m.line}: ${m.text.trimEnd()}`,
    )
    .join("\n")
}

export type CrossGlobHit = {
  repositoryId: string
  relativePath: string
  absolutePath: string
  mtime: number
}

/**
 * Glob across explicitly listed repositories. Callers must pass repositoryIds
 * (never implied all).
 */
export function globAcross(
  info: Info,
  input: {
    pattern: string
    repositoryIds: string[]
    signal?: AbortSignal
    limit?: number
  },
) {
  return Effect.gen(function* () {
    const rg = yield* Ripgrep.Service
    const fs = yield* AppFileSystem.Service
    const limit = input.limit ?? 100
    const hits: CrossGlobHit[] = []

    for (const id of input.repositoryIds) {
      if (hits.length >= limit) break
      const repo = rootOf(info, id)
      const files = yield* rg.files({ cwd: repo.canonicalPath, glob: [input.pattern], signal: input.signal }).pipe(
        Stream.mapEffect((file) =>
          Effect.gen(function* () {
            const absolutePath = AppFileSystem.resolve(
              path.isAbsolute(file) ? file : path.join(repo.canonicalPath, file),
            )
            const hit = locate(info, absolutePath)
            if (!hit || hit.repository.id !== id) return
            const st = yield* fs.stat(absolutePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
            const mtime =
              st?.mtime.pipe(
                Option.map((date) => date.getTime()),
                Option.getOrElse(() => 0),
              ) ?? 0
            hits.push({
              repositoryId: id,
              relativePath: hit.location.relativePath,
              absolutePath,
              mtime,
            })
          }),
        ),
        Stream.take(limit - hits.length + 1),
        Stream.runDrain,
      )
      void files
    }

    const truncated = hits.length > limit
    if (truncated) hits.length = limit
    hits.sort((a, b) => b.mtime - a.mtime)
    return { hits, truncated }
  })
}

export function formatGlobHits(hits: CrossGlobHit[]) {
  return hits.map((h) => formatLocation({ repositoryId: h.repositoryId, relativePath: h.relativePath })).join("\n")
}

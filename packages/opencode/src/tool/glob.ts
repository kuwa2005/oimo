import path from "path"
import z from "zod"
import { Effect, Option } from "effect"
import * as Stream from "effect/Stream"
import { InstanceState } from "@/effect"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { assertReadAllowed } from "./external-directory"
import { SessionCwd } from "./session-cwd"
import DESCRIPTION from "./glob.txt"
import * as Tool from "./tool"

export const GlobTool = Tool.define(
  "glob",
  Effect.gen(function* () {
    const rg = yield* Ripgrep.Service
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: z.object({
        pattern: z.string().describe("The glob pattern to match files against"),
        path: z
          .string()
          .optional()
          .describe(
            `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
          ),
        repositoryIds: z
          .array(z.string())
          .optional()
          .describe(
            "When a multi-repo workspace is configured: repository ids to search (explicit only — never implied all). Results are prefixed with repo-id:path.",
          ),
      }),
      execute: (params: { pattern: string; path?: string; repositoryIds?: string[] }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          yield* ctx.ask({
            permission: "glob",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
              repositoryIds: params.repositoryIds,
            },
          })

          if (params.repositoryIds?.length) {
            const { Runtime, globAcross, formatGlobHits } = yield* Effect.promise(() => import("@/repo-workspace"))
            const workspace = yield* Effect.tryPromise(() => Runtime.current()).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            )
            if (!workspace) {
              return {
                title: params.pattern,
                metadata: { count: 0, truncated: false },
                output: "No multi-repo workspace loaded; omit repositoryIds or configure repos.txt / workspace.yaml",
              }
            }
            const result = yield* globAcross(workspace, {
              pattern: params.pattern,
              repositoryIds: params.repositoryIds,
              signal: ctx.abort,
              limit: 100,
            }).pipe(Effect.provide(Ripgrep.defaultLayer), Effect.provide(AppFileSystem.defaultLayer), Effect.orDie)
            if (result.hits.length === 0) {
              return {
                title: params.pattern,
                metadata: { count: 0, truncated: false },
                output: "No files found",
              }
            }
            return {
              title: params.pattern,
              metadata: { count: result.hits.length, truncated: result.truncated },
              output: [
                `Found ${result.hits.length} files across [${params.repositoryIds.join(", ")}]${result.truncated ? " (truncated)" : ""}`,
                formatGlobHits(result.hits),
              ].join("\n"),
            }
          }

          let search = params.path ?? SessionCwd.get(ctx.sessionID)
          search = path.isAbsolute(search) ? search : path.resolve(SessionCwd.get(ctx.sessionID), search)
          const info = yield* fs.stat(search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (info?.type === "File") {
            throw new Error(`glob path must be a directory: ${search}`)
          }
          yield* assertReadAllowed(ctx, search, { kind: "directory" })

          const limit = 100
          let truncated = false
          const files = yield* rg.files({ cwd: search, glob: [params.pattern], signal: ctx.abort }).pipe(
            Stream.mapEffect((file) =>
              Effect.gen(function* () {
                const full = path.resolve(search, file)
                const st = yield* fs.stat(full).pipe(Effect.catch(() => Effect.succeed(undefined)))
                const mtime =
                  st?.mtime.pipe(
                    Option.map((date) => date.getTime()),
                    Option.getOrElse(() => 0),
                  ) ?? 0
                return { path: full, mtime }
              }),
            ),
            Stream.take(limit + 1),
            Stream.runCollect,
            Effect.map((chunk) => [...chunk]),
          )

          if (files.length > limit) {
            truncated = true
            files.length = limit
          }
          files.sort((a, b) => b.mtime - a.mtime)

          const { Runtime, Policy } = yield* Effect.promise(() => import("@/repo-workspace"))
          const workspace = yield* Effect.tryPromise(() => Runtime.current()).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          )
          const lines =
            files.length === 0
              ? ["No files found"]
              : files.map((file) => {
                  if (!workspace) return file.path
                  const hit = Policy.decideRead(workspace, { absolutePath: file.path })
                  if (!hit.ok) return file.path
                  return `${hit.location.repositoryId}:${hit.location.relativePath}`
                })
          if (truncated) {
            lines.push("")
            lines.push(
              `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`,
            )
          }

          return {
            title: path.relative(ins.worktree, search),
            metadata: {
              count: files.length,
              truncated,
            },
            output: lines.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

/** Distinguish pre-existing dirty files from oimo-authored mutations. */

import type { Info } from "./schema"
import { rootOf } from "./resolve"

export type DirtyBaseline = {
  repositoryId: string
  files: string[]
  capturedAt: string
}

const bySession = new Map<string, Map<string, DirtyBaseline>>()

function porcelain(cwd: string) {
  const r = Bun.spawnSync(["git", "status", "--porcelain", "-z"], { cwd, stdout: "pipe", stderr: "pipe" })
  if (r.exitCode !== 0) return [] as string[]
  // Do not trim leading spaces — porcelain XY codes are space-padded (e.g. " M path").
  const text = Buffer.from(r.stdout).toString("utf8")
  return text
    .split("\0")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
}

export function captureBaseline(sessionID: string, info: Info, repositoryIds?: string[]) {
  const ids = repositoryIds?.length ? repositoryIds : [...info.repositories.keys()]
  const map = bySession.get(sessionID) ?? new Map<string, DirtyBaseline>()
  for (const id of ids) {
    const repo = rootOf(info, id)
    if (repo.kind === "directory") continue
    map.set(id, {
      repositoryId: id,
      files: porcelain(repo.canonicalPath),
      capturedAt: new Date().toISOString(),
    })
  }
  bySession.set(sessionID, map)
  return [...map.values()]
}

export function getBaseline(sessionID: string, repositoryId: string) {
  return bySession.get(sessionID)?.get(repositoryId)
}

export function listBaselines(sessionID: string) {
  const map = bySession.get(sessionID)
  if (!map) return [] as DirtyBaseline[]
  return [...map.values()]
}

/** Restore baselines from durable session fingerprint / DB payload. */
export function restoreBaselines(sessionID: string, rows: DirtyBaseline[]) {
  const map = new Map<string, DirtyBaseline>()
  for (const row of rows) {
    map.set(row.repositoryId, {
      repositoryId: row.repositoryId,
      files: [...row.files],
      capturedAt: row.capturedAt,
    })
  }
  bySession.set(sessionID, map)
  return [...map.values()]
}

export function serializeBaselines(sessionID: string) {
  return listBaselines(sessionID)
}

/** True if relativePath was already dirty before oimo started mutating. */
export function wasPreExistingDirty(sessionID: string, repositoryId: string, relativePath: string) {
  const base = getBaseline(sessionID, repositoryId)
  if (!base) return false
  const norm = relativePath.replace(/\\/g, "/")
  return base.files.some((f) => f.replace(/\\/g, "/") === norm || f.endsWith("/" + norm) || f.endsWith(norm))
}

export function assertNotTouchingBaseline(
  sessionID: string,
  repositoryId: string,
  relativePath: string,
): { ok: true } | { ok: false; message: string } {
  if (!wasPreExistingDirty(sessionID, repositoryId, relativePath)) return { ok: true }
  return {
    ok: false,
    message: `Refusing to modify pre-existing dirty file "${repositoryId}:${relativePath}" (captured at session start). Resolve or exclude it first.`,
  }
}

export function clearBaselines(sessionID?: string) {
  if (sessionID) {
    bySession.delete(sessionID)
    return
  }
  bySession.clear()
}

import { Instance } from "@/project/instance"
import type { Info } from "./schema"
import { findConfigPath, loadFromPrimary, RepoWorkspaceError } from "./load"
import { findReposListPath } from "./repos-list"
import { isSuperproject } from "./gitmodules"
import { doctor as runDoctor } from "./doctor"
import * as SessionFingerprint from "./session-fingerprint"
import * as ChangeSet from "./change-set"
import * as Scope from "./scope"

const cache = new Map<string, Promise<Info | undefined>>()

/** Load (and cache) RepoWorkspace for a directory. Missing config → undefined. */
export function load(directory: string): Promise<Info | undefined> {
  const key = directory
  const hit = cache.get(key)
  if (hit) return hit
  const task = loadFromPrimary(directory).catch((error) => {
    if (cache.get(key) === task) cache.delete(key)
    throw error
  })
  cache.set(key, task)
  return task
}

export function invalidate(directory?: string) {
  if (directory) {
    cache.delete(directory)
    return
  }
  cache.clear()
}

async function hasWorkspaceConfig(directory: string) {
  if (await findConfigPath(directory)) return true
  if (findReposListPath(directory)) return true
  if (isSuperproject(directory)) return true
  return false
}

/** Current Instance directory's workspace, if any. Load errors become undefined. */
export async function current(): Promise<Info | undefined> {
  try {
    return await load(Instance.directory)
  } catch {
    return
  }
}

/**
 * Like current(), but if a workspace config file exists and load fails,
 * throw fail-closed instead of silently falling back to single-repo mode.
 */
export async function currentStrict(): Promise<Info | undefined> {
  const directory = Instance.directory
  try {
    return await load(directory)
  } catch (error) {
    if (await hasWorkspaceConfig(directory)) {
      throw new RepoWorkspaceError(
        "load_failed",
        error instanceof Error ? error.message : String(error),
      )
    }
    return
  }
}

export async function doctorCurrent() {
  const info = await current()
  if (!info) return
  return { info, report: runDoctor(info) }
}

/** Persist fingerprint for a session when a workspace is active. */
export async function captureSession(sessionID: string, directory?: string) {
  const info = await load(directory ?? Instance.directory)
  if (!info) return
  const baselineMod = await import("./dirty-baseline")
  if (!baselineMod.listBaselines(sessionID).length) {
    baselineMod.captureBaseline(sessionID, info)
  }
  return SessionFingerprint.save(sessionID, info)
}

export async function restoreSession(sessionID: string) {
  const fp = await SessionFingerprint.load(sessionID)
  if (!fp) return { ok: true as const, fingerprint: undefined, changeSet: ChangeSet.loadChangeSet(sessionID) }
  const base = SessionFingerprint.reconcile(fp)
  if (!base.ok) return base
  const info = await load(Instance.directory)
  if (!info) {
    return {
      ok: false as const,
      code: "workspace_missing",
      message: "Session had a multi-repo fingerprint but no workspace is loaded now",
    }
  }
  const live = SessionFingerprint.reconcileLive(fp, info)
  if (!live.ok) return live
  ChangeSet.loadChangeSet(sessionID)
  Scope.getScope(sessionID)
  if (fp.dirtyBaselines?.length) {
    const baselineMod = await import("./dirty-baseline")
    baselineMod.restoreBaselines(sessionID, fp.dirtyBaselines)
  }
  const { loadGoalBinding, assertBoundTriad } = await import("./goal-binding")
  const binding = loadGoalBinding(sessionID)
  const cs = ChangeSet.loadChangeSet(sessionID)
  const scope = Scope.getScope(sessionID)
  const triad = assertBoundTriad({
    workspaceFingerprint: binding?.workspaceFingerprint,
    changeSetID: binding?.changeSetID ?? cs?.id,
    executionScope: binding?.executionScope ?? (scope ? [...scope] : undefined),
    liveFingerprint: SessionFingerprint.workspaceFingerprintKey(info),
  })
  if (!triad.ok) return triad
  return {
    ok: true as const,
    fingerprint: live.fingerprint,
    info,
    changeSet: cs,
    goalBinding: binding,
    dirtyBaselines: fp.dirtyBaselines ?? [],
  }
}

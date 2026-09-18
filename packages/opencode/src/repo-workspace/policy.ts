/**
 * Single Policy entry for multi-repo read / write / command / git decisions.
 * Tools must use this module rather than re-interpreting Resolver results.
 */
import path from "path"
import { fileURLToPath } from "url"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import type { Info, Location, RepositoryDescriptor } from "./schema"
import { resolveRead, resolveWrite, formatLocation, type ResolveReadResult, type ResolveWriteResult } from "./resolve"
import * as Scope from "./scope"
import * as ChangeSet from "./change-set"
import * as SessionFingerprint from "./session-fingerprint"
import * as DirtyBaseline from "./dirty-baseline"

export type ReadDecision =
  | { ok: true; repository: RepositoryDescriptor; location: Location; absolutePath: string }
  | { ok: false; code: string; message: string }

export type WriteDecision =
  | { ok: true; repository: RepositoryDescriptor; location: Location; absolutePath: string }
  | { ok: false; code: string; message: string }

export type CommandDecision =
  | { ok: true; repository: RepositoryDescriptor; cwd: string }
  | { ok: false; code: string; message: string }

function activeScope(sessionID: string): Set<string> | undefined {
  const scope = Scope.getScope(sessionID)
  if (scope) return scope
  const cs = ChangeSet.loadChangeSet(sessionID)
  if (cs && cs.status !== "cancelled" && cs.status !== "planned") return new Set(cs.executionScope)
  return
}

export function decideRead(
  info: Info,
  input: { repositoryId?: string; path: string } | { absolutePath: string },
): ReadDecision {
  const hit: ResolveReadResult = resolveRead(info, input)
  if (!hit.ok) {
    if (hit.code === "unregistered" && info.defaults.allowUnregisteredReads) {
      return hit
    }
    return hit
  }
  return hit
}

export function decideWrite(
  info: Info,
  sessionID: string,
  input: { repositoryId?: string; path: string } | { absolutePath: string },
): WriteDecision {
  const hit: ResolveWriteResult = resolveWrite(info, input)
  if (!hit.ok) {
    if (hit.code === "unregistered" && info.defaults.allowUnregisteredWrites) {
      return { ok: false, code: hit.code, message: hit.message }
    }
    return hit
  }

  const scope = activeScope(sessionID)
  if (scope && scope.size > 0 && !scope.has(hit.repository.id)) {
    return {
      ok: false,
      code: "outside_scope",
      message: `Repository "${hit.repository.id}" is not in execution scope [${[...scope].join(", ")}]`,
    }
  }

  const cs = ChangeSet.loadChangeSet(sessionID)
  if (
    info.defaults.requireCrossRepoPlan &&
    hit.repository.id !== info.primaryRepositoryId &&
    (!cs || !cs.plan.approvedAt)
  ) {
    const hasScope = scope && scope.has(hit.repository.id)
    if (!hasScope) {
      return {
        ok: false,
        code: "plan_required",
        message: `Cross-repo write to "${hit.repository.id}" needs an approved change plan`,
      }
    }
  }

  if (cs?.plan.approvedAt && cs.approvalFingerprint) {
    const ignoreFilesByRepo: Record<string, string[]> = {}
    for (const row of cs.repos) {
      ignoreFilesByRepo[row.repositoryId] = row.files.map((f) => f.relativePath)
    }
    // The path about to be written is also an oimo mutation once Policy allows it.
    if ("path" in input && input.repositoryId) {
      const list = ignoreFilesByRepo[input.repositoryId] ?? []
      ignoreFilesByRepo[input.repositoryId] = [...list, input.path]
    } else if (hit.ok) {
      const list = ignoreFilesByRepo[hit.repository.id] ?? []
      ignoreFilesByRepo[hit.repository.id] = [...list, hit.location.relativePath]
    }
    const stale = SessionFingerprint.isApprovalStale(info, cs.approvalFingerprint, { ignoreFilesByRepo })
    if (stale) {
      return {
        ok: false,
        code: "stale_approval",
        message: stale.message,
      }
    }
  }

  if (cs && cs.kind !== "customer") {
    return {
      ok: false,
      code: "wrong_change_set_kind",
      message: `Active Change set kind is "${cs.kind}"; customer repo writes require a customer Change set`,
    }
  }

  const baseline = DirtyBaseline.assertNotTouchingBaseline(
    sessionID,
    hit.repository.id,
    hit.location.relativePath,
  )
  if (!baseline.ok) {
    return { ok: false, code: "preexisting_dirty", message: baseline.message }
  }

  return hit
}

export function decideCommand(
  info: Info,
  sessionID: string,
  input: { repositoryId?: string; workdir?: string; mutating: boolean },
): CommandDecision {
  const repositoryId = input.repositoryId ?? info.primaryRepositoryId
  const repo = info.repositories.get(repositoryId)
  if (!repo) {
    return { ok: false, code: "unknown_repository", message: `Unknown repository id "${repositoryId}"` }
  }

  const cwd = input.workdir
    ? (() => {
        const joined = path.isAbsolute(input.workdir!)
          ? input.workdir!
          : path.resolve(repo.canonicalPath, input.workdir!)
        const abs = AppFileSystem.resolve(joined)
        const read = decideRead(info, { absolutePath: abs })
        if (!read.ok) return read
        if (read.repository.id !== repositoryId) {
          return {
            ok: false as const,
            code: "outside_root",
            message: `workdir is outside repository "${repositoryId}"`,
          }
        }
        return { ok: true as const, cwd: read.absolutePath }
      })()
    : { ok: true as const, cwd: repo.canonicalPath }

  if (!cwd.ok) return cwd

  if (input.mutating) {
    const write = decideWrite(info, sessionID, { absolutePath: cwd.cwd })
    if (!write.ok) return write
  }

  return { ok: true, repository: repo, cwd: cwd.cwd }
}

export function displayPath(info: Info | undefined, absolutePath: string, fallbackWorktree: string) {
  if (info) {
    const hit = decideRead(info, { absolutePath })
    if (hit.ok) return formatLocation(hit.location)
  }
  return path.relative(fallbackWorktree, absolutePath) || absolutePath
}

export function formatRepoPath(location: Location) {
  return formatLocation(location)
}

/** Reject mutating plugin ask patterns that would bypass multi-repo Policy. */
export function assertPluginAskPatterns(
  info: Info,
  sessionID: string,
  input: { toolId: string; permission: string; patterns: readonly string[]; directory: string },
): { ok: true } | { ok: false; message: string } {
  const mutating = ["edit", "write", "bash", "external_directory"].includes(input.permission)
  if (!mutating || !input.patterns.length) return { ok: true }
  for (const pattern of input.patterns) {
    if (!pattern || pattern === "*") {
      return {
        ok: false,
        message: `repo-workspace: plugin tool "${input.toolId}" must pass concrete path patterns under multi-repo (got ${JSON.stringify(pattern)})`,
      }
    }
    if (/[*?]/.test(pattern)) {
      return {
        ok: false,
        message: `repo-workspace: plugin tool "${input.toolId}" cannot use glob write patterns under multi-repo Policy`,
      }
    }
    const abs = path.isAbsolute(pattern) ? pattern : path.resolve(input.directory, pattern)
    const hit = decideWrite(info, sessionID, { absolutePath: abs })
    if (!hit.ok) return { ok: false, message: `repo-workspace write denied (${hit.code}): ${hit.message}` }
  }
  return { ok: true }
}

/** Rewrite absolute paths / file:// URIs in LSP-style JSON to `repo-id:path`. */
export function annotatePaths(info: Info | undefined, value: unknown, fallbackWorktree: string): unknown {
  if (value == null) return value
  if (typeof value === "string") {
    if (value.startsWith("file:")) {
      try {
        const abs = fileURLToPath(value)
        return displayPath(info, abs, fallbackWorktree)
      } catch {
        return value
      }
    }
    if (path.isAbsolute(value)) return displayPath(info, value, fallbackWorktree)
    return value
  }
  if (Array.isArray(value)) return value.map((item) => annotatePaths(info, item, fallbackWorktree))
  if (typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = annotatePaths(info, v, fallbackWorktree)
    }
    return out
  }
  return value
}

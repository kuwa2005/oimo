/** Repository-aware Git facade — never assume Instance.worktree alone. */

import type { Info } from "./schema"
import { rootOf } from "./resolve"
import { snapshotGit } from "./session-fingerprint"
import * as DirtyBaseline from "./dirty-baseline"

export type RepoGitStatus = {
  repositoryId: string
  root: string
  head?: string
  branch?: string
  dirty: boolean
  remoteNames: string[]
  porcelain: string
}

function run(cwd: string, args: string[]) {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  return {
    ok: r.exitCode === 0,
    text: Buffer.from(r.stdout).toString("utf8").trim(),
    stderr: Buffer.from(r.stderr).toString("utf8").trim(),
    exitCode: r.exitCode ?? 1,
  }
}

export function status(info: Info, repositoryId: string): RepoGitStatus {
  const repo = rootOf(info, repositoryId)
  if (repo.kind === "directory") {
    return {
      repositoryId,
      root: repo.canonicalPath,
      dirty: false,
      remoteNames: [],
      porcelain: "",
    }
  }
  const snap = snapshotGit(repo)
  const porcelain = run(repo.canonicalPath, ["status", "--porcelain"])
  return {
    repositoryId,
    root: repo.canonicalPath,
    head: snap?.head,
    branch: snap?.branch,
    dirty: snap?.dirty ?? false,
    remoteNames: snap?.remoteNames ?? [],
    porcelain: porcelain.ok ? porcelain.text : "",
  }
}

export function statusAll(info: Info) {
  return [...info.repositories.keys()].map((id) => status(info, id))
}

export function diff(info: Info, repositoryId: string, base?: string) {
  const repo = rootOf(info, repositoryId)
  const args = base ? ["diff", base] : ["diff"]
  const r = run(repo.canonicalPath, args)
  return {
    repositoryId,
    ok: r.ok,
    text: r.text,
    stderr: r.stderr,
    exitCode: r.exitCode,
  }
}

export function branch(info: Info, repositoryId: string) {
  const st = status(info, repositoryId)
  return { repositoryId, branch: st.branch, head: st.head }
}

/** Refuse destructive git ops that completion-instructions forbid as automatic. */
export function assertSafeGitArgs(args: string[]) {
  const joined = args.join(" ")
  const banned = [
    /reset\s+--hard/,
    /clean\s+-[^\s]*f/,
    /push\s+[^\n]*--force/,
    /push\s+[^\n]*\s-f\b/,
    /submodule\s+update/,
    /checkout\s+--force/,
    /branch\s+-D/,
  ]
  for (const re of banned) {
    if (re.test(joined)) {
      throw new Error(`repo-workspace git denied: destructive operation not auto-run (${joined})`)
    }
  }
}

/**
 * Drop pre-existing dirty paths from a proposed `git add` list so oimo never
 * stages unrelated local edits into a customer Change set commit.
 */
export function filterStagePaths(input: {
  sessionID: string
  repositoryId: string
  relativePaths: string[]
}) {
  const allowed: string[] = []
  const blocked: string[] = []
  for (const relativePath of input.relativePaths) {
    if (DirtyBaseline.wasPreExistingDirty(input.sessionID, input.repositoryId, relativePath)) {
      blocked.push(relativePath)
      continue
    }
    allowed.push(relativePath)
  }
  return { allowed, blocked }
}

/**
 * Resolve the git cwd for a workspace operation.
 * repositoryId omitted → primary. Unknown id throws (fail closed).
 */
export function resolveCwd(info: Info, repositoryId?: string) {
  const id = repositoryId ?? info.primaryRepositoryId
  const repo = info.repositories.get(id)
  if (!repo) throw new Error(`Unknown repository id "${id}"`)
  if (repo.kind === "directory") {
    throw new Error(`Repository "${id}" is a plain directory; git operations require a git/submodule root`)
  }
  return { repositoryId: id, cwd: repo.canonicalPath, repository: repo }
}

/** Per-repo status map suitable for API / TUI (never collapse to one worktree). */
export function statusMap(info: Info) {
  const out: Record<string, RepoGitStatus> = {}
  for (const row of statusAll(info)) out[row.repositoryId] = row
  return out
}

/**
 * Resolve git cwd for CLI/API callers.
 * Without a workspace (or without repositoryId), returns fallbackCwd (usually Instance.worktree).
 */
export async function resolveWorktreeCwd(input: {
  directory: string
  repositoryId?: string
  fallbackCwd: string
}) {
  if (!input.repositoryId) return { cwd: input.fallbackCwd, repositoryId: undefined as string | undefined }
  const { loadFromPrimary } = await import("./load")
  const info = await loadFromPrimary(input.directory).catch(() => undefined)
  if (!info) {
    throw new Error(
      `repositoryId "${input.repositoryId}" requires a multi-repo workspace (workspace.yaml / repos.txt / .gitmodules)`,
    )
  }
  const hit = resolveCwd(info, input.repositoryId)
  return { cwd: hit.cwd, repositoryId: hit.repositoryId, info }
}

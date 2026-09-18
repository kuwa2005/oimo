import * as fs from "fs"
import path from "path"
import { Global } from "@/global"
import type { GitSnapshot, Info, RepositoryDescriptor } from "./schema"
import { fingerprint, RepoWorkspaceError } from "./load"

export type SessionFingerprint = {
  version: 1
  sessionID: string
  capturedAt: number
  workspace: ReturnType<typeof fingerprint>
  git: Record<string, GitSnapshot>
  /** Pre-existing dirty files per repo at capture/approval time. */
  dirtyBaselines?: Array<{
    repositoryId: string
    files: string[]
    capturedAt: string
  }>
}

function git(cwd: string, args: string[]) {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  return {
    ok: r.exitCode === 0,
    text: Buffer.from(r.stdout).toString("utf8").replace(/\0+$/, "").replace(/\n+$/, ""),
  }
}

export function snapshotGit(repo: RepositoryDescriptor): GitSnapshot | undefined {
  if (repo.kind !== "git") return
  const head = git(repo.canonicalPath, ["rev-parse", "HEAD"])
  const branch = git(repo.canonicalPath, ["rev-parse", "--abbrev-ref", "HEAD"])
  const dirty = git(repo.canonicalPath, ["status", "--porcelain"])
  const remotes = git(repo.canonicalPath, ["remote"])
  return {
    head: head.ok ? head.text : undefined,
    branch: branch.ok && branch.text !== "HEAD" ? branch.text : undefined,
    dirty: dirty.ok ? dirty.text.length > 0 : false,
    remoteNames: remotes.ok ? remotes.text.split("\n").filter(Boolean) : [],
  }
}

export function capture(info: Info, sessionID: string): SessionFingerprint {
  const gitSnaps: Record<string, GitSnapshot> = {}
  for (const repo of info.repositories.values()) {
    const snap = snapshotGit(repo)
    if (snap) gitSnaps[repo.id] = snap
  }
  return {
    version: 1,
    sessionID,
    capturedAt: Date.now(),
    workspace: fingerprint(info),
    git: gitSnaps,
  }
}

function storePath(sessionID: string) {
  return path.join(Global.Path.data, "repo-workspace", "sessions", `${sessionID}.json`)
}

export async function save(sessionID: string, info: Info) {
  const file = storePath(sessionID)
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const data = capture(info, sessionID)
  const baselineMod = await import("./dirty-baseline")
  const baselines = baselineMod.serializeBaselines(sessionID)
  if (baselines.length) data.dirtyBaselines = baselines
  await Bun.write(file, JSON.stringify(data, null, 2))
  return data
}

export async function load(sessionID: string): Promise<SessionFingerprint | undefined> {
  const file = storePath(sessionID)
  if (!fs.existsSync(file)) return
  return JSON.parse(await Bun.file(file).text()) as SessionFingerprint
}

export type ReconcileResult =
  | { ok: true; fingerprint: SessionFingerprint }
  | { ok: false; code: string; message: string; repositoryId?: string }

/**
 * Re-open a saved fingerprint against the live filesystem.
 * Does not guess moved paths — missing roots fail closed.
 */
export function reconcile(fp: SessionFingerprint): ReconcileResult {
  if (fp.version !== 1) {
    return { ok: false, code: "unsupported_version", message: `Unsupported fingerprint version ${fp.version}` }
  }
  if (!fs.existsSync(fp.workspace.configPath)) {
    return {
      ok: false,
      code: "config_missing",
      message: `Workspace config missing: ${fp.workspace.configPath}. Re-resolve the workspace; paths are not guessed.`,
    }
  }
  for (const repo of fp.workspace.repositories) {
    if (!fs.existsSync(repo.canonicalPath) || !fs.statSync(repo.canonicalPath).isDirectory()) {
      return {
        ok: false,
        code: "repository_missing",
        message: `Repository "${repo.id}" path missing: ${repo.canonicalPath}. Re-resolve; do not guess a new location.`,
        repositoryId: repo.id,
      }
    }
  }
  return { ok: true, fingerprint: fp }
}

export function assertReconciled(fp: SessionFingerprint) {
  const result = reconcile(fp)
  if (!result.ok) throw new RepoWorkspaceError(result.code, result.message, result.repositoryId)
  return result.fingerprint
}

export function dirtyHash(repo: RepositoryDescriptor): string | undefined {
  if (repo.kind !== "git") return
  const dirty = git(repo.canonicalPath, ["status", "--porcelain"])
  if (!dirty.ok) return
  return Bun.hash(dirty.text).toString(16)
}

export function dirtyFiles(repo: RepositoryDescriptor): string[] {
  if (repo.kind !== "git") return []
  const dirty = git(repo.canonicalPath, ["status", "--porcelain", "-z"])
  if (!dirty.ok || !dirty.text) return []
  return dirty.text
    .split("\0")
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
}

export function workspaceFingerprintKey(info: Info) {
  return JSON.stringify(fingerprint(info))
}

export function buildApprovalFingerprint(
  info: Info,
  graphFingerprint?: string,
): import("./repo-workspace.sql").ApprovalFingerprint {
  const repos: import("./repo-workspace.sql").ApprovalFingerprint["repos"] = {}
  for (const repo of info.repositories.values()) {
    const snap = snapshotGit(repo)
    repos[repo.id] = {
      head: snap?.head,
      branch: snap?.branch,
      dirty: snap?.dirty ?? false,
      dirtyHash: dirtyHash(repo),
      dirtyFiles: dirtyFiles(repo),
    }
  }
  return {
    workspaceFingerprint: workspaceFingerprintKey(info),
    configPath: info.configPath,
    graphFingerprint,
    repos,
  }
}

/** Compare live workspace state against an approval fingerprint. */
export function isApprovalStale(
  info: Info,
  approval: import("./repo-workspace.sql").ApprovalFingerprint,
  opts?: { ignoreFilesByRepo?: Record<string, string[]> },
): { code: string; message: string; repositoryId?: string } | undefined {
  if (workspaceFingerprintKey(info) !== approval.workspaceFingerprint) {
    return {
      code: "config_changed",
      message: "Workspace config changed since plan approval; re-run doctor, impact, and approve again.",
    }
  }
  if (!fs.existsSync(approval.configPath)) {
    return { code: "config_missing", message: `Workspace config missing: ${approval.configPath}` }
  }
  for (const repo of info.repositories.values()) {
    const expected = approval.repos[repo.id]
    if (!expected) continue
    const live = snapshotGit(repo)
    if ((live?.head ?? undefined) !== expected.head) {
      return {
        code: "head_changed",
        message: `Repository "${repo.id}" HEAD changed since approval; re-plan required.`,
        repositoryId: repo.id,
      }
    }
    const ignore = new Set(
      (opts?.ignoreFilesByRepo?.[repo.id] ?? []).map((p) => p.replace(/\\/g, "/")),
    )
    if (expected.dirtyFiles) {
      const liveExternal = dirtyFiles(repo)
        .map((p) => p.replace(/\\/g, "/"))
        .filter((p) => !ignore.has(p))
        .sort()
      const approvedExternal = expected.dirtyFiles
        .map((p) => p.replace(/\\/g, "/"))
        .filter((p) => !ignore.has(p))
        .sort()
      if (JSON.stringify(liveExternal) !== JSON.stringify(approvedExternal)) {
        return {
          code: "dirty_changed",
          message: `Repository "${repo.id}" dirty state changed since approval; re-plan required.`,
          repositoryId: repo.id,
        }
      }
    } else {
      const liveDirty = dirtyHash(repo)
      if ((liveDirty ?? "") !== (expected.dirtyHash ?? "") || (live?.dirty ?? false) !== expected.dirty) {
        return {
          code: "dirty_changed",
          message: `Repository "${repo.id}" dirty state changed since approval; re-plan required.`,
          repositoryId: repo.id,
        }
      }
    }
  }
  return
}

/**
 * Full restore check used when reopening a session: path reconcile + live git drift.
 */
export function reconcileLive(fp: SessionFingerprint, info: Info): ReconcileResult {
  const base = reconcile(fp)
  if (!base.ok) return base
  if (JSON.stringify(fingerprint(info)) !== JSON.stringify(fp.workspace)) {
    return {
      ok: false,
      code: "workspace_changed",
      message: "Workspace fingerprint changed since session capture; re-resolve before writing.",
    }
  }
  for (const [id, snap] of Object.entries(fp.git)) {
    const repo = info.repositories.get(id)
    if (!repo) {
      return {
        ok: false,
        code: "repository_missing",
        message: `Repository "${id}" no longer registered`,
        repositoryId: id,
      }
    }
    const live = snapshotGit(repo)
    if ((live?.head ?? undefined) !== snap.head) {
      return {
        ok: false,
        code: "head_changed",
        message: `Repository "${id}" HEAD changed since session start`,
        repositoryId: id,
      }
    }
    if ((live?.dirty ?? false) !== snap.dirty) {
      return {
        ok: false,
        code: "dirty_changed",
        message: `Repository "${id}" dirty state changed since session start`,
        repositoryId: id,
      }
    }
  }
  return { ok: true, fingerprint: fp }
}

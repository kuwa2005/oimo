import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as RepoWorkspace from "../../src/repo-workspace"

const dirs: string[] = []

afterEach(() => {
  RepoWorkspace.ChangeSet.clearChangeSets()
  RepoWorkspace.Scope.clearAllScopes()
  RepoWorkspace.DirtyBaseline.clearBaselines()
  while (dirs.length) {
    const d = dirs.pop()
    if (d) fs.rmSync(d, { recursive: true, force: true })
  }
})

describe("EvidenceJudge", () => {
  test("current completion-evidence.md is COMPLETE → ok:true", () => {
    const root = path.resolve(import.meta.dir, "../../../..")
    const manifest = path.join(root, "docs/multi-repo/completion-evidence.md")
    const audit = RepoWorkspace.EvidenceJudge.auditEvidenceManifest(manifest)
    expect(audit.ok).toBe(true)
    expect(audit.unfinished).toEqual([])
    expect(audit.blockers.length).toBe(12)
  })

  test("synthetic all-done manifest → ok:true", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oimo-ev-"))
    dirs.push(dir)
    const file = path.join(dir, "completion-evidence.md")
    fs.writeFileSync(
      file,
      [
        "# Multi-repo completion evidence (release-complete)",
        "",
        "| # | Blocker | Status | Evidence |",
        "|---|---------|--------|----------|",
        "| 1 | a | **done** | x |",
        "| 2 | b | **done (scoped)** | y |",
      ].join("\n"),
    )
    const audit = RepoWorkspace.EvidenceJudge.auditEvidenceManifest(file)
    expect(audit.ok).toBe(true)
    expect(audit.unfinished.length).toBe(0)
  })
})

describe("Plan approve / reject existing Change set", () => {
  test("approveExistingChangeSet transitions planned → approved", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "oimo-approve-"))
    dirs.push(root)
    const backend = path.join(root, "backend")
    fs.mkdirSync(backend, { recursive: true })
    expect(Bun.spawnSync(["git", "init"], { cwd: backend }).exitCode).toBe(0)
    Bun.spawnSync(["git", "config", "user.email", "t@t.com"], { cwd: backend })
    Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: backend })
    fs.writeFileSync(path.join(backend, "README.md"), "x\n")
    Bun.spawnSync(["git", "add", "."], { cwd: backend })
    Bun.spawnSync(["git", "commit", "-m", "i"], { cwd: backend })
    fs.mkdirSync(path.join(backend, ".oimo"), { recursive: true })
    const configPath = path.join(backend, ".oimo", "workspace.yaml")
    fs.writeFileSync(
      configPath,
      ["version: 1", "name: a", "primary: backend", "repositories:", "  - id: backend", "    path: ."].join("\n"),
    )
    const info = await RepoWorkspace.loadFromFile(configPath, backend)
    const session = "approve-sess"
    const started = RepoWorkspace.Plan.beginChangeSet({
      sessionID: session,
      info,
      plan: RepoWorkspace.ChangeSet.createPlan({
        title: "t",
        mustChange: [{ repositoryId: "backend", summary: "x" }],
        reviewOnly: [],
        executionOrder: ["backend"],
      }),
      autoApprove: false,
    })
    RepoWorkspace.ChangeSet.saveChangeSet(started.changeSet)
    expect(started.changeSet.status).toBe("planned")
    const approved = RepoWorkspace.Plan.approveExistingChangeSet({ sessionID: session, info, by: "user" })
    expect(approved.status).toBe("approved")
    expect(approved.plan.approvedAt).toBeTruthy()
    expect([...(RepoWorkspace.Scope.getScope(session) ?? [])]).toContain("backend")

    const cancelled = RepoWorkspace.Plan.rejectChangeSet(session)
    expect(cancelled.status).toBe("cancelled")
  })
})

describe("single-repo compatibility extras", () => {
  test("Policy/Git helpers degrade safely without workspace config", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oimo-single-"))
    dirs.push(dir)
    expect(Bun.spawnSync(["git", "init"], { cwd: dir }).exitCode).toBe(0)
    Bun.spawnSync(["git", "config", "user.email", "t@t.com"], { cwd: dir })
    Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: dir })
    fs.writeFileSync(path.join(dir, "a.ts"), "export {}\n")
    Bun.spawnSync(["git", "add", "."], { cwd: dir })
    Bun.spawnSync(["git", "commit", "-m", "i"], { cwd: dir })

    await RepoWorkspace.Runtime.invalidate()
    const info = await RepoWorkspace.Runtime.load(dir)
    expect(info).toBeUndefined()

    const cwd = await RepoWorkspace.Git.resolveWorktreeCwd({
      directory: dir,
      fallbackCwd: dir,
    })
    expect(cwd.cwd).toBe(dir)
    expect(cwd.repositoryId).toBeUndefined()

    await expect(
      RepoWorkspace.Git.resolveWorktreeCwd({
        directory: dir,
        repositoryId: "ghost",
        fallbackCwd: dir,
      }),
    ).rejects.toThrow(/requires a multi-repo workspace/)

    // Without workspace, Policy.displayPath falls back to worktree-relative paths
    expect(RepoWorkspace.Policy.displayPath(undefined, path.join(dir, "a.ts"), dir)).toBe("a.ts")
    // globAcross without workspace is not used; Runtime.current stays undefined
    expect(await RepoWorkspace.Runtime.current()).toBeUndefined()
  })
})

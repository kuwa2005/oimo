import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as RepoWorkspace from "../../src/repo-workspace"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { Effect, Layer } from "effect"

const dirs: string[] = []

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oimo-multirepo-policy-"))
  dirs.push(dir)
  return dir
}

function gitInit(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  const r = Bun.spawnSync(["git", "init"], { cwd: dir, stdout: "pipe", stderr: "pipe" })
  expect(r.exitCode).toBe(0)
  Bun.spawnSync(["git", "config", "user.email", "test@example.com"], { cwd: dir })
  Bun.spawnSync(["git", "config", "user.name", "test"], { cwd: dir })
  fs.writeFileSync(path.join(dir, "README.md"), "# t\n")
  Bun.spawnSync(["git", "add", "."], { cwd: dir })
  Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: dir })
}

async function siblingWorkspace() {
  const root = tmpRoot()
  const backend = path.join(root, "backend")
  const frontend = path.join(root, "frontend")
  const infra = path.join(root, "infra")
  gitInit(backend)
  gitInit(frontend)
  gitInit(infra)
  fs.mkdirSync(path.join(backend, ".oimo"), { recursive: true })
  const configPath = path.join(backend, ".oimo", "workspace.yaml")
  fs.writeFileSync(
    configPath,
    [
      "version: 1",
      "name: demo",
      "primary: backend",
      "repositories:",
      "  - id: backend",
      "    path: .",
      "  - id: frontend",
      "    path: ../frontend",
      "  - id: infra",
      "    path: ../infra",
      "    access: read-only",
    ].join("\n"),
  )
  const info = await RepoWorkspace.loadFromFile(configPath, backend)
  return { root, backend, frontend, infra, info }
}

afterEach(() => {
  RepoWorkspace.ChangeSet.clearChangeSets()
  RepoWorkspace.Scope.clearAllScopes()
  RepoWorkspace.DirtyBaseline.clearBaselines()
  while (dirs.length) {
    const d = dirs.pop()
    if (d) fs.rmSync(d, { recursive: true, force: true })
  }
})

describe("RepoWorkspace Policy", () => {
  test("decideRead allows primary and sibling; denies unregistered", async () => {
    const { info, frontend } = await siblingWorkspace()
    const ok = RepoWorkspace.Policy.decideRead(info, {
      repositoryId: "frontend",
      path: "README.md",
    })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.location.repositoryId).toBe("frontend")

    const bad = RepoWorkspace.Policy.decideRead(info, {
      absolutePath: path.join(path.dirname(frontend), "outside", "x"),
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.code).toBe("unregistered")
  })

  test("decideWrite denies read-only and outside scope", async () => {
    const { info } = await siblingWorkspace()
    const session = "sess-policy-1"
    const ro = RepoWorkspace.Policy.decideWrite(info, session, {
      repositoryId: "infra",
      path: "README.md",
    })
    expect(ro.ok).toBe(false)
    if (!ro.ok) expect(ro.code).toBe("read_only")

    const started = RepoWorkspace.Plan.beginChangeSet({
      sessionID: session,
      info,
      plan: RepoWorkspace.ChangeSet.createPlan({
        title: "t",
        mustChange: [{ repositoryId: "frontend", summary: "ui" }],
        reviewOnly: [],
        executionOrder: ["frontend"],
      }),
      autoApprove: true,
    })
    RepoWorkspace.ChangeSet.saveChangeSet(started.changeSet)
    RepoWorkspace.Scope.setScope(session, started.changeSet.executionScope)

    const scoped = RepoWorkspace.Policy.decideWrite(info, session, {
      repositoryId: "backend",
      path: "README.md",
    })
    expect(scoped.ok).toBe(false)
    if (!scoped.ok) expect(scoped.code).toBe("outside_scope")

    const allowed = RepoWorkspace.Policy.decideWrite(info, session, {
      repositoryId: "frontend",
      path: "README.md",
    })
    expect(allowed.ok).toBe(true)
  })

  test("stale approval after HEAD change denies write", async () => {
    const { info, frontend } = await siblingWorkspace()
    const session = "sess-stale"
    const started = RepoWorkspace.Plan.beginChangeSet({
      sessionID: session,
      info,
      plan: RepoWorkspace.ChangeSet.createPlan({
        title: "t",
        mustChange: [{ repositoryId: "frontend", summary: "ui" }],
        reviewOnly: [],
        executionOrder: ["frontend"],
      }),
      autoApprove: true,
    })
    RepoWorkspace.ChangeSet.saveChangeSet(started.changeSet)
    RepoWorkspace.Scope.setScope(session, started.changeSet.executionScope)

    fs.writeFileSync(path.join(frontend, "extra.txt"), "x\n")
    Bun.spawnSync(["git", "add", "."], { cwd: frontend })
    Bun.spawnSync(["git", "commit", "-m", "drift"], { cwd: frontend })

    const denied = RepoWorkspace.Policy.decideWrite(info, session, {
      repositoryId: "frontend",
      path: "README.md",
    })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.code).toBe("stale_approval")
  })
})

describe("RepoWorkspace globAcross + git facade", () => {
  test("globAcross returns repo-id:path and never implies all", async () => {
    const { info, frontend } = await siblingWorkspace()
    fs.writeFileSync(path.join(frontend, "App.tsx"), "export const x = 1\n")
    const layer = Layer.mergeAll(Ripgrep.defaultLayer, AppFileSystem.defaultLayer)
    const result = await Effect.runPromise(
      RepoWorkspace.globAcross(info, {
        pattern: "*.tsx",
        repositoryIds: ["frontend"],
      }).pipe(Effect.provide(layer)),
    )
    expect(result.hits.length).toBe(1)
    expect(result.hits[0]?.repositoryId).toBe("frontend")
    expect(RepoWorkspace.formatGlobHits(result.hits)).toContain("frontend:")
  })

  test("Git.status reports per-repo HEAD", async () => {
    const { info } = await siblingWorkspace()
    const a = RepoWorkspace.Git.status(info, "backend")
    const b = RepoWorkspace.Git.status(info, "frontend")
    expect(a.head).toBeTruthy()
    expect(b.head).toBeTruthy()
    expect(a.repositoryId).toBe("backend")
  })

  test("Git.resolveCwd selects repository root; unknown id fails closed", async () => {
    const { info, frontend } = await siblingWorkspace()
    const hit = RepoWorkspace.Git.resolveCwd(info, "frontend")
    expect(hit.cwd).toBe(frontend)
    expect(hit.repositoryId).toBe("frontend")
    expect(() => RepoWorkspace.Git.resolveCwd(info, "missing")).toThrow()
    const map = RepoWorkspace.Git.statusMap(info)
    expect(Object.keys(map).sort()).toEqual(["backend", "frontend", "infra"].sort())
  })
})

describe("DirtyBaseline persistence", () => {
  test("serialize → clear → restore keeps preexisting_dirty protection", async () => {
    const { info, backend } = await siblingWorkspace()
    const session = "sess-baseline-persist"
    fs.writeFileSync(path.join(backend, "pre.txt"), "dirty\n")
    RepoWorkspace.DirtyBaseline.captureBaseline(session, info, ["backend"])
    const serialized = RepoWorkspace.DirtyBaseline.serializeBaselines(session)
    expect(serialized.some((b) => b.files.includes("pre.txt"))).toBe(true)
    RepoWorkspace.DirtyBaseline.clearBaselines(session)
    expect(RepoWorkspace.DirtyBaseline.wasPreExistingDirty(session, "backend", "pre.txt")).toBe(false)
    RepoWorkspace.DirtyBaseline.restoreBaselines(session, serialized)
    expect(RepoWorkspace.DirtyBaseline.wasPreExistingDirty(session, "backend", "pre.txt")).toBe(true)
    const denied = RepoWorkspace.Policy.decideWrite(info, session, {
      repositoryId: "backend",
      path: "pre.txt",
    })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.code).toBe("preexisting_dirty")
  })
})

describe("Change set persistence round-trip", () => {
  test("saveChangeSet survives clear of memory via DB reload", async () => {
    const { info } = await siblingWorkspace()
    const session = `sess-persist-${Date.now()}`
    const started = RepoWorkspace.Plan.beginChangeSet({
      sessionID: session,
      info,
      plan: RepoWorkspace.ChangeSet.createPlan({
        title: "persist",
        mustChange: [{ repositoryId: "frontend", summary: "ui" }],
        reviewOnly: [],
        executionOrder: ["frontend"],
      }),
      autoApprove: true,
    })
    RepoWorkspace.ChangeSet.saveChangeSet(started.changeSet)
    RepoWorkspace.ChangeSet.clearChangeSets()
    const loaded = RepoWorkspace.ChangeSet.loadChangeSet(session)
    expect(loaded?.id).toBe(started.changeSet.id)
    expect(loaded?.status).toBe("approved")
    expect(loaded?.approvalFingerprint).toBeTruthy()
  })
})

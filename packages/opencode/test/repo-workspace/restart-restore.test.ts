import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { pathToFileURL } from "url"
import * as RepoWorkspace from "../../src/repo-workspace"
import { Instance } from "../../src/project/instance"
import { resolveAbsolute } from "../../src/repo-workspace/resolve"

const dirs: string[] = []

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oimo-restart-"))
  dirs.push(dir)
  return dir
}

function gitInit(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  expect(Bun.spawnSync(["git", "init"], { cwd: dir }).exitCode).toBe(0)
  Bun.spawnSync(["git", "config", "user.email", "t@t.com"], { cwd: dir })
  Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: dir })
  fs.writeFileSync(path.join(dir, "README.md"), "x\n")
  Bun.spawnSync(["git", "add", "."], { cwd: dir })
  Bun.spawnSync(["git", "commit", "-m", "i"], { cwd: dir })
}

afterEach(() => {
  RepoWorkspace.ChangeSet.clearChangeSets()
  RepoWorkspace.Scope.clearAllScopes()
  RepoWorkspace.DirtyBaseline.clearBaselines()
  RepoWorkspace.Runtime.invalidate()
  while (dirs.length) {
    const d = dirs.pop()
    if (d) fs.rmSync(d, { recursive: true, force: true })
  }
})

describe("session restart restore (process-local clear ≈ restart)", () => {
  test("Change set + scope + DirtyBaseline + Goal binding restore together", async () => {
    const root = tmpRoot()
    const backend = path.join(root, "backend")
    const frontend = path.join(root, "frontend")
    gitInit(backend)
    gitInit(frontend)
    fs.writeFileSync(path.join(backend, "pre.txt"), "already dirty\n")
    fs.mkdirSync(path.join(backend, ".oimo"), { recursive: true })
    const configPath = path.join(backend, ".oimo", "workspace.yaml")
    fs.writeFileSync(
      configPath,
      [
        "version: 1",
        "name: restart",
        "primary: backend",
        "repositories:",
        "  - id: backend",
        "    path: .",
        "  - id: frontend",
        "    path: ../frontend",
      ].join("\n"),
    )
    const info = await RepoWorkspace.loadFromFile(configPath, backend)
    const session = `restart-${Date.now()}`
    const fp = RepoWorkspace.SessionFingerprint.workspaceFingerprintKey(info)

    const started = RepoWorkspace.Plan.beginChangeSet({
      sessionID: session,
      info,
      plan: RepoWorkspace.ChangeSet.createPlan({
        title: "restart",
        mustChange: [{ repositoryId: "frontend", summary: "ui" }],
        reviewOnly: [],
        executionOrder: ["frontend"],
      }),
      autoApprove: true,
    })
    RepoWorkspace.ChangeSet.saveChangeSet(started.changeSet)
    RepoWorkspace.Scope.setScope(session, started.changeSet.executionScope)
    RepoWorkspace.DirtyBaseline.captureBaseline(session, info, ["backend", "frontend"])
    await RepoWorkspace.GoalBindingStore.persistGoalBinding(session, {
      condition: "multi-repo complete",
      phase: "execute",
      workspaceFingerprint: fp,
      changeSetID: started.changeSet.id,
      executionScope: started.changeSet.executionScope,
      startedAt: Date.now(),
      evidenceManifestPath: "docs/multi-repo/completion-evidence.md",
    })
    // Persist fingerprint (includes dirtyBaselines)
    await Instance.provide({
      directory: backend,
      fn: async () => {
        await RepoWorkspace.Runtime.captureSession(session, backend)
      },
    })

    const csId = started.changeSet.id

    // Simulate process restart: wipe memory caches
    RepoWorkspace.ChangeSet.clearChangeSets()
    RepoWorkspace.Scope.clearAllScopes()
    RepoWorkspace.DirtyBaseline.clearBaselines()

    expect(RepoWorkspace.ChangeSet.loadChangeSet(session)?.id).toBe(csId)
    expect([...(RepoWorkspace.Scope.getScope(session) ?? [])].sort()).toEqual(["frontend"])
    expect(RepoWorkspace.GoalBindingStore.loadGoalBinding(session)?.changeSetID).toBe(csId)

    await Instance.provide({
      directory: backend,
      fn: async () => {
        const restored = await RepoWorkspace.Runtime.restoreSession(session)
        expect(restored.ok).toBe(true)
        if (!restored.ok) return
        expect(restored.changeSet?.id).toBe(csId)
        expect(restored.goalBinding?.workspaceFingerprint).toBe(fp)
        expect(restored.dirtyBaselines?.some((b) => b.repositoryId === "backend")).toBe(true)
      },
    })

    // Pre-existing dirty still protected after restore
    expect(RepoWorkspace.DirtyBaseline.wasPreExistingDirty(session, "backend", "pre.txt")).toBe(true)
    const denied = RepoWorkspace.Policy.decideWrite(info, session, {
      repositoryId: "backend",
      path: "pre.txt",
    })
    // backend outside scope → outside_scope, OR preexisting_dirty if in scope
    expect(denied.ok).toBe(false)
  })
})

describe("LSP / view-image path resolution + evolve isolation", () => {
  test("resolveAbsolute + decideRead for LSP-style repositoryId path", async () => {
    const root = tmpRoot()
    const backend = path.join(root, "backend")
    const frontend = path.join(root, "frontend")
    gitInit(backend)
    gitInit(frontend)
    fs.mkdirSync(path.join(frontend, "src"), { recursive: true })
    fs.writeFileSync(path.join(frontend, "src", "App.tsx"), "export const App = () => null\n")
    fs.mkdirSync(path.join(backend, ".oimo"), { recursive: true })
    const configPath = path.join(backend, ".oimo", "workspace.yaml")
    fs.writeFileSync(
      configPath,
      [
        "version: 1",
        "name: lsp",
        "primary: backend",
        "repositories:",
        "  - id: backend",
        "    path: .",
        "  - id: frontend",
        "    path: ../frontend",
      ].join("\n"),
    )
    const info = await RepoWorkspace.loadFromFile(configPath, backend)
    const abs = resolveAbsolute(info, "frontend", "src/App.tsx")
    expect(abs).toBe(path.join(frontend, "src", "App.tsx"))
    const read = RepoWorkspace.Policy.decideRead(info, { repositoryId: "frontend", path: "src/App.tsx" })
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.location.repositoryId).toBe("frontend")

    // Same relative path in two repos must not collapse to primary
    fs.mkdirSync(path.join(backend, "src"), { recursive: true })
    fs.writeFileSync(path.join(backend, "src", "App.tsx"), "export const BackendApp = 1\n")
    const be = resolveAbsolute(info, "backend", "src/App.tsx")
    const fe = resolveAbsolute(info, "frontend", "src/App.tsx")
    expect(be).not.toBe(fe)

    // LSP-style Location payloads must keep repository identity in display form
    const uri = pathToFileURL(fe).href
    const annotated = RepoWorkspace.Policy.annotatePaths(
      info,
      [{ uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } }],
      backend,
    ) as Array<{ uri: string }>
    expect(annotated[0].uri).toBe("frontend:src/App.tsx")
    expect(annotated[0].uri).not.toContain(fe)
  })

  test("evolve and customer Change sets use separate storage; path kind must match", async () => {
    const root = tmpRoot()
    const backend = path.join(root, "backend")
    gitInit(backend)
    fs.mkdirSync(path.join(backend, ".oimo"), { recursive: true })
    const configPath = path.join(backend, ".oimo", "workspace.yaml")
    fs.writeFileSync(
      configPath,
      ["version: 1", "name: evo", "primary: backend", "repositories:", "  - id: backend", "    path: ."].join("\n"),
    )
    await RepoWorkspace.loadFromFile(configPath, backend)
    const session = "evolve-mix"

    const customer = RepoWorkspace.ChangeSet.createChangeSet({
      sessionID: session,
      plan: RepoWorkspace.ChangeSet.createPlan({
        title: "cust",
        mustChange: [{ repositoryId: "backend", summary: "x" }],
        reviewOnly: [],
        executionOrder: ["backend"],
      }),
      executionScope: ["backend"],
      kind: "customer",
    })
    const evolve = RepoWorkspace.ChangeSet.createChangeSet({
      sessionID: session,
      plan: RepoWorkspace.ChangeSet.createPlan({
        title: "evo",
        mustChange: [],
        reviewOnly: [],
        executionOrder: [],
      }),
      executionScope: [],
      kind: "evolve",
    })
    RepoWorkspace.ChangeSet.saveChangeSet(customer)
    RepoWorkspace.ChangeSet.saveChangeSet(evolve)
    expect(RepoWorkspace.ChangeSet.loadChangeSet(session, "customer")?.id).toBe(customer.id)
    expect(RepoWorkspace.ChangeSet.loadChangeSet(session, "evolve")?.id).toBe(evolve.id)
    expect(RepoWorkspace.ChangeSet.loadChangeSet(session, "customer")?.id).not.toBe(evolve.id)

    expect(
      RepoWorkspace.ChangeSet.assertKindAllowsPath(
        customer,
        path.join(os.homedir(), ".oimo", "evolve", "proj", "note.md"),
      ).ok,
    ).toBe(false)
    expect(RepoWorkspace.ChangeSet.assertKindAllowsPath(customer, path.join(backend, "README.md")).ok).toBe(true)
    expect(
      RepoWorkspace.ChangeSet.assertKindAllowsPath(
        evolve,
        path.join(os.homedir(), ".oimo", "evolve", "proj", "note.md"),
      ).ok,
    ).toBe(true)
  })
})

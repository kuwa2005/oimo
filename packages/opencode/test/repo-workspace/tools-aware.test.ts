import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { Effect, Layer } from "effect"
import * as RepoWorkspace from "../../src/repo-workspace"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { Instance } from "../../src/project/instance"
import { Instruction } from "../../src/session/instruction"
import { MessageID } from "../../src/session/schema"

const dirs: string[] = []

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oimo-tools-aware-"))
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

async function siblingWorkspace() {
  const root = tmpRoot()
  const backend = path.join(root, "backend")
  const frontend = path.join(root, "frontend")
  const outside = path.join(root, "outside")
  gitInit(backend)
  gitInit(frontend)
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(outside, "secret.env"), "KEY=1\n")
  fs.mkdirSync(path.join(backend, "src"), { recursive: true })
  fs.mkdirSync(path.join(frontend, "src"), { recursive: true })
  fs.writeFileSync(path.join(backend, "src", "a.ts"), "export const a = 1\n")
  fs.writeFileSync(path.join(frontend, "src", "b.ts"), "export const b = 2\n")
  fs.writeFileSync(path.join(backend, "AGENTS.md"), "# BACKEND ONLY — never apply to frontend\n")
  fs.writeFileSync(path.join(frontend, "AGENTS.md"), "# FRONTEND ONLY — use React patterns\n")
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
    ].join("\n"),
  )
  const info = await RepoWorkspace.loadFromFile(configPath, backend)
  return { root, backend, frontend, outside, info, configPath }
}

describe("Repository-aware read / glob / display", () => {
  test("decideRead allows sibling by repositoryId; denies unregistered", async () => {
    const { info, frontend, outside } = await siblingWorkspace()
    const ok = RepoWorkspace.Policy.decideRead(info, { repositoryId: "frontend", path: "src/b.ts" })
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.location.repositoryId).toBe("frontend")
      expect(RepoWorkspace.Policy.formatRepoPath(ok.location)).toBe("frontend:src/b.ts")
    }

    const abs = RepoWorkspace.Policy.decideRead(info, { absolutePath: path.join(frontend, "src", "b.ts") })
    expect(abs.ok).toBe(true)

    const bad = RepoWorkspace.Policy.decideRead(info, { absolutePath: path.join(outside, "secret.env") })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.code).toBe("unregistered")
  })

  test("globAcross never implies all repos; results are repo-id:path", async () => {
    const { info } = await siblingWorkspace()
    const layer = Layer.mergeAll(Ripgrep.defaultLayer, AppFileSystem.defaultLayer)
    const one = await Effect.runPromise(
      RepoWorkspace.globAcross(info, { pattern: "**/*.ts", repositoryIds: ["frontend"] }).pipe(Effect.provide(layer)),
    )
    expect(one.hits.every((h) => h.repositoryId === "frontend")).toBe(true)
    expect(RepoWorkspace.formatGlobHits(one.hits)).toContain("frontend:")
    expect(RepoWorkspace.formatGlobHits(one.hits)).not.toContain("backend:")

    const primaryOnly = await Effect.runPromise(
      RepoWorkspace.globAcross(info, { pattern: "**/*.ts", repositoryIds: ["backend"] }).pipe(Effect.provide(layer)),
    )
    expect(primaryOnly.hits.every((h) => h.repositoryId === "backend")).toBe(true)
  })

  test("displayPath uses RepositoryLocation not ../ sibling", async () => {
    const { info, frontend, backend } = await siblingWorkspace()
    const shown = RepoWorkspace.Policy.displayPath(info, path.join(frontend, "src", "b.ts"), backend)
    expect(shown.startsWith("frontend:")).toBe(true)
    expect(shown.includes("..")).toBe(false)
  })
})

describe("per-repo AGENTS isolation", () => {
  test("locate owns sibling file; Instruction.resolve does not pull primary AGENTS into frontend", async () => {
    const { info, backend, frontend } = await siblingWorkspace()
    const feFile = path.join(frontend, "src", "b.ts")
    const hit = RepoWorkspace.locate(info, feFile)
    expect(hit?.repository.id).toBe("frontend")
    expect(hit?.repository.canonicalPath).toBe(frontend)

    await Instance.provide({
      directory: backend,
      fn: () =>
        Effect.runPromise(
          Instruction.Service.use((svc) =>
            Effect.gen(function* () {
              const results = yield* svc.resolve([], feFile, MessageID.make("msg-fe-1"))
              const texts = results.map((r) => r.content).join("\n")
              expect(texts).toContain("FRONTEND ONLY")
              expect(texts).not.toContain("BACKEND ONLY")
            }),
          ).pipe(Effect.provide(Instruction.defaultLayer)),
        ),
    })
  })
})

describe("shell adversarial Policy vectors", () => {
  test("decideCommand denies mutating cwd in read-only sibling", async () => {
    const { info, frontend } = await siblingWorkspace()
    // mark frontend read-only in a fresh workspace
    const root = path.dirname(frontend)
    const backend = path.join(root, "backend")
    fs.writeFileSync(
      path.join(backend, ".oimo", "workspace.yaml"),
      [
        "version: 1",
        "name: demo",
        "primary: backend",
        "repositories:",
        "  - id: backend",
        "    path: .",
        "  - id: frontend",
        "    path: ../frontend",
        "    access: read-only",
      ].join("\n"),
    )
    const ro = await RepoWorkspace.loadFromFile(path.join(backend, ".oimo", "workspace.yaml"), backend)
    const denied = RepoWorkspace.Policy.decideCommand(ro, "s", {
      repositoryId: "frontend",
      mutating: true,
    })
    expect(denied.ok).toBe(false)
  })

  test("git -C into unregistered path is denied by Policy write", async () => {
    const { info, outside } = await siblingWorkspace()
    const hit = RepoWorkspace.Policy.decideWrite(info, "s", { absolutePath: outside })
    expect(hit.ok).toBe(false)
    if (!hit.ok) expect(hit.code).toBe("unregistered")
  })

  test("ShellJail treats tee/cp as opaque writes without path coverage", () => {
    const jail = RepoWorkspace.ShellJail.planJail({
      shell: "/bin/bash",
      command: "echo x | tee /tmp/out",
      cwd: "/tmp",
      writableRoots: [],
    })
    expect(jail.mode).toBe("policy-only")
    expect(
      RepoWorkspace.ShellJail.assertPolicyOnlySafe({
        command: "cp a b",
        pathCovered: false,
        jail,
      }).ok,
    ).toBe(false)
    expect(
      RepoWorkspace.ShellJail.assertPolicyOnlySafe({
        command: "echo x | tee ./in-repo.txt",
        pathCovered: true,
        jail,
      }).ok,
    ).toBe(true)
  })

  test("Git.assertSafeGitArgs blocks force push and clean -f", () => {
    expect(() => RepoWorkspace.Git.assertSafeGitArgs(["push", "--force", "origin", "main"])).toThrow()
    expect(() => RepoWorkspace.Git.assertSafeGitArgs(["clean", "-fd"])).toThrow()
    expect(() => RepoWorkspace.Git.assertSafeGitArgs(["status", "--porcelain"])).not.toThrow()
  })
})

describe("Goal binding triad", () => {
  test("persist + load Goal binding; incomplete triad blocks resume", async () => {
    const { info } = await siblingWorkspace()
    const session = `goal-bind-${Date.now()}`
    const fp = RepoWorkspace.SessionFingerprint.workspaceFingerprintKey(info)
    await RepoWorkspace.GoalBindingStore.persistGoalBinding(session, {
      condition: "multi-repo complete",
      phase: "execute",
      workspaceFingerprint: fp,
      changeSetID: "cs-1",
      executionScope: ["backend", "frontend"],
      startedAt: Date.now(),
      evidenceManifestPath: "docs/multi-repo/completion-evidence.md",
    })
    const loaded = RepoWorkspace.GoalBindingStore.loadGoalBinding(session)
    expect(loaded?.condition).toBe("multi-repo complete")
    expect(loaded?.executionScope).toEqual(["backend", "frontend"])

    const incomplete = RepoWorkspace.GoalBindingStore.assertBoundTriad({
      workspaceFingerprint: fp,
      changeSetID: "cs-1",
      // missing executionScope
    })
    expect(incomplete.ok).toBe(false)

    const ok = RepoWorkspace.GoalBindingStore.assertBoundTriad({
      workspaceFingerprint: fp,
      changeSetID: "cs-1",
      executionScope: ["backend"],
      liveFingerprint: fp,
    })
    expect(ok.ok).toBe(true)
  })
})

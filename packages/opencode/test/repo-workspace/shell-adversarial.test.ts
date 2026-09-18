import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as RepoWorkspace from "../../src/repo-workspace"
import { resolveInRoots } from "../../src/workflow/workspace"
import { assertSkillAllowedForWorkspace } from "../../src/skill"
import { assertBoundTriad } from "../../src/repo-workspace/goal-binding"

const dirs: string[] = []

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oimo-shell-adv-"))
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
  while (dirs.length) {
    const d = dirs.pop()
    if (d) fs.rmSync(d, { recursive: true, force: true })
  }
})

async function twoRepo() {
  const root = tmpRoot()
  const backend = path.join(root, "backend")
  const frontend = path.join(root, "frontend")
  const outside = path.join(root, "outside")
  gitInit(backend)
  gitInit(frontend)
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(outside, "x.txt"), "secret\n")
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
      "    access: read-only",
    ].join("\n"),
  )
  const info = await RepoWorkspace.loadFromFile(configPath, backend)
  return { root, backend, frontend, outside, info }
}

describe("shell / workflow adversarial", () => {
  test("Policy denies write into read-only sibling via absolute path", async () => {
    const { info, frontend } = await twoRepo()
    const hit = RepoWorkspace.Policy.decideWrite(info, "s", {
      absolutePath: path.join(frontend, "hack.txt"),
    })
    expect(hit.ok).toBe(false)
    if (!hit.ok) expect(hit.code).toBe("read_only")
  })

  test("Policy denies unregistered outside path", async () => {
    const { info, outside } = await twoRepo()
    const hit = RepoWorkspace.Policy.decideWrite(info, "s", {
      absolutePath: path.join(outside, "x.txt"),
    })
    expect(hit.ok).toBe(false)
    if (!hit.ok) expect(hit.code).toBe("unregistered")
  })

  test("Git.assertSafeGitArgs blocks reset --hard", () => {
    expect(() => RepoWorkspace.Git.assertSafeGitArgs(["git", "reset", "--hard"])).toThrow()
  })

  test("workflow resolveInRoots blocks .. escape and symlink escape", async () => {
    const { backend, frontend, outside } = await twoRepo()
    expect(() => resolveInRoots([backend], "../frontend/README.md")).toThrow()
    expect(() => resolveInRoots([backend], outside)).toThrow()
    const ok = resolveInRoots([backend, frontend], path.join(frontend, "README.md"))
    expect(ok).toContain("frontend")
  })

  test("skill capability defaults to single-repo and blocks multi-repo writes", () => {
    expect(() =>
      assertSkillAllowedForWorkspace({ name: "x" }, { multiRepo: true, needsWrite: true }),
    ).toThrow()
    expect(() =>
      assertSkillAllowedForWorkspace(
        { name: "x", capability: "multi-repo-write" },
        { multiRepo: true, needsWrite: true },
      ),
    ).not.toThrow()
  })

  test("Goal triad incomplete binding is rejected", () => {
    const r = assertBoundTriad({
      workspaceFingerprint: "abc",
      changeSetID: "cs-1",
    })
    expect(r.ok).toBe(false)
  })

  test("DirtyBaseline blocks pre-existing dirty files", async () => {
    const { info, backend } = await twoRepo()
    const session = "sess-dirty"
    fs.writeFileSync(path.join(backend, "pre.txt"), "already dirty\n")
    RepoWorkspace.DirtyBaseline.captureBaseline(session, info, ["backend"])
    const blocked = RepoWorkspace.DirtyBaseline.assertNotTouchingBaseline(session, "backend", "pre.txt")
    expect(blocked.ok).toBe(false)
    const ok = RepoWorkspace.DirtyBaseline.assertNotTouchingBaseline(session, "backend", "new.txt")
    expect(ok.ok).toBe(true)

    // Policy path must refuse the same pre-existing dirty file
    const viaPolicy = RepoWorkspace.Policy.decideWrite(info, session, {
      repositoryId: "backend",
      path: "pre.txt",
    })
    expect(viaPolicy.ok).toBe(false)
    if (!viaPolicy.ok) expect(viaPolicy.code).toBe("preexisting_dirty")

    const stage = RepoWorkspace.Git.filterStagePaths({
      sessionID: session,
      repositoryId: "backend",
      relativePaths: ["pre.txt", "new.txt"],
    })
    expect(stage.blocked).toContain("pre.txt")
    expect(stage.allowed).toContain("new.txt")
  })

  test("ShellJail refuses opaque writes without path coverage when no bwrap", () => {
    const jail = RepoWorkspace.ShellJail.planJail({
      shell: "/bin/bash",
      command: "tee /tmp/x",
      cwd: "/tmp",
      writableRoots: [],
    })
    // empty roots → policy-only
    expect(jail.mode).toBe("policy-only")
    const denied = RepoWorkspace.ShellJail.assertPolicyOnlySafe({
      command: "python3 -c 'open(\"x\",\"w\")'",
      pathCovered: false,
      jail,
    })
    expect(denied.ok).toBe(false)
    const allowed = RepoWorkspace.ShellJail.assertPolicyOnlySafe({
      command: "ls -la",
      pathCovered: false,
      jail,
    })
    expect(allowed.ok).toBe(true)
  })

  test("evolve Change set does not overwrite customer Change set", () => {
    const session = "sess-kinds"
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
    expect(RepoWorkspace.ChangeSet.inferKindFromPath("/home/u/.oimo/evolve/proj/x.md")).toBe("evolve")
    expect(RepoWorkspace.ChangeSet.inferKindFromPath("/repo/src/a.ts")).toBe("customer")
  })

  test("plugin ask patterns must pass Policy under multi-repo", async () => {
    const { info, backend } = await twoRepo()
    const session = "sess-plugin"
    const planned = RepoWorkspace.Plan.beginChangeSet({
      sessionID: session,
      info,
      plan: RepoWorkspace.ChangeSet.createPlan({
        title: "p",
        mustChange: [{ repositoryId: "backend", summary: "x" }],
        reviewOnly: [],
        executionOrder: ["backend"],
      }),
      autoApprove: true,
    })
    RepoWorkspace.ChangeSet.saveChangeSet(planned.changeSet)

    const star = RepoWorkspace.Policy.assertPluginAskPatterns(info, session, {
      toolId: "demo",
      permission: "edit",
      patterns: ["*"],
      directory: backend,
    })
    expect(star.ok).toBe(false)

    const outside = RepoWorkspace.Policy.assertPluginAskPatterns(info, session, {
      toolId: "demo",
      permission: "write",
      patterns: ["/tmp/evil"],
      directory: backend,
    })
    expect(outside.ok).toBe(false)

    const ok = RepoWorkspace.Policy.assertPluginAskPatterns(info, session, {
      toolId: "demo",
      permission: "edit",
      patterns: [path.join(backend, "README.md")],
      directory: backend,
    })
    expect(ok.ok).toBe(true)

    const readAsk = RepoWorkspace.Policy.assertPluginAskPatterns(info, session, {
      toolId: "demo",
      permission: "read",
      patterns: ["*"],
      directory: backend,
    })
    expect(readAsk.ok).toBe(true)
  })

  test("workflow file hooks refuse write-only Policy denial", async () => {
    const { makeFileHooksForRoots } = await import("../../src/workflow/workspace")
    const { Instance } = await import("../../src/project/instance")
    const { backend, frontend } = await twoRepo()
    await Instance.provide({
      directory: backend,
      fn: async () => {
        await RepoWorkspace.Runtime.invalidate()
        const info = await RepoWorkspace.Runtime.load(backend)
        expect(info).toBeTruthy()
        const session = "wf-policy"
        const planned = RepoWorkspace.Plan.beginChangeSet({
          sessionID: session,
          info: info!,
          plan: RepoWorkspace.ChangeSet.createPlan({
            title: "p",
            mustChange: [{ repositoryId: "backend", summary: "x" }],
            reviewOnly: [],
            executionOrder: ["backend"],
          }),
          autoApprove: true,
        })
        RepoWorkspace.ChangeSet.saveChangeSet(planned.changeSet)
        const hooks = makeFileHooksForRoots([backend, frontend], { sessionID: session })
        // frontend is read-only in fixture → Policy deny even if root jail would allow
        await expect(hooks.writeFile(path.join(frontend, "x.ts"), "export {}\n")).rejects.toThrow(
          /repo-workspace write denied/,
        )
        // backend in scope → ok
        await hooks.writeFile(path.join(backend, "ok.ts"), "export {}\n")
        expect(fs.existsSync(path.join(backend, "ok.ts"))).toBe(true)
      },
    })
  })
})

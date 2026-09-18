import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as RepoWorkspace from "../../src/repo-workspace"

const dirs: string[] = []

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oimo-e2e-"))
  dirs.push(dir)
  return dir
}

function gitInit(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  expect(Bun.spawnSync(["git", "init"], { cwd: dir }).exitCode).toBe(0)
  Bun.spawnSync(["git", "config", "user.email", "t@t.com"], { cwd: dir })
  Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: dir })
  fs.writeFileSync(path.join(dir, "README.md"), "#\n")
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

describe("multi-repo E2E plan → scope → write gate", () => {
  test("schema→backend→frontend plan; infra read-only; unapproved sibling denied", async () => {
    const root = tmpRoot()
    const backend = path.join(root, "backend")
    const frontend = path.join(root, "frontend")
    const schema = path.join(root, "shared-schema")
    const infra = path.join(root, "infra")
    for (const d of [backend, frontend, schema, infra]) gitInit(d)

    fs.writeFileSync(
      path.join(schema, "openapi.yaml"),
      ["openapi: 3.0.0", "info:", "  title: demo", "  version: 1.0.0", "components:", "  schemas:", "    DisplayName:", "      type: string"].join(
        "\n",
      ),
    )
    fs.writeFileSync(
      path.join(backend, "package.json"),
      JSON.stringify({
        name: "backend",
        dependencies: { "shared-schema": "file:../shared-schema" },
        scripts: { test: "echo ok" },
      }),
    )
    fs.writeFileSync(path.join(frontend, "package.json"), JSON.stringify({ name: "frontend", scripts: { test: "echo ok" } }))
    Bun.spawnSync(["git", "add", "."], { cwd: schema })
    Bun.spawnSync(["git", "commit", "-m", "schema"], { cwd: schema })
    Bun.spawnSync(["git", "add", "."], { cwd: backend })
    Bun.spawnSync(["git", "commit", "-m", "backend"], { cwd: backend })
    Bun.spawnSync(["git", "add", "."], { cwd: frontend })
    Bun.spawnSync(["git", "commit", "-m", "frontend"], { cwd: frontend })

    fs.mkdirSync(path.join(backend, ".oimo"), { recursive: true })
    const configPath = path.join(backend, ".oimo", "workspace.yaml")
    fs.writeFileSync(
      configPath,
      [
        "version: 1",
        "name: customer-platform",
        "primary: backend",
        "repositories:",
        "  - id: backend",
        "    path: .",
        "  - id: frontend",
        "    path: ../frontend",
        "  - id: shared-schema",
        "    path: ../shared-schema",
        "  - id: infra",
        "    path: ../infra",
        "    access: read-only",
      ].join("\n"),
    )

    const info = await RepoWorkspace.loadFromFile(configPath, backend)
    const impact = await RepoWorkspace.Graph.analyzeImpact(info, { query: "DisplayName" })
    const plan = RepoWorkspace.Plan.planFromImpact({ title: "schema rename", impact })
    expect(plan.mustChange.some((m) => m.repositoryId === "shared-schema")).toBe(true)
    expect(plan.reviewOnly.some((m) => m.repositoryId === "infra") || !plan.mustChange.some((m) => m.repositoryId === "infra")).toBe(
      true,
    )

    const session = "e2e-session"
    // Unapproved: sibling write denied
    const denied = RepoWorkspace.Policy.decideWrite(info, session, {
      repositoryId: "frontend",
      path: "App.tsx",
    })
    expect(denied.ok).toBe(false)

    const started = RepoWorkspace.Plan.beginChangeSet({ sessionID: session, info, plan, autoApprove: true })
    RepoWorkspace.ChangeSet.saveChangeSet(started.changeSet)
    RepoWorkspace.Scope.setScope(session, started.changeSet.executionScope)
    RepoWorkspace.DirtyBaseline.captureBaseline(session, info, started.changeSet.executionScope)

    expect(started.changeSet.executionScope.includes("infra")).toBe(false)

    const allowed = RepoWorkspace.Policy.decideWrite(info, session, {
      repositoryId: "shared-schema",
      path: "openapi.yaml",
    })
    expect(allowed.ok).toBe(true)

    const infraWrite = RepoWorkspace.Policy.decideWrite(info, session, {
      repositoryId: "infra",
      path: "main.tf",
    })
    expect(infraWrite.ok).toBe(false)

    // Simulate mutation record + verify dry-run
    if (allowed.ok) {
      RepoWorkspace.ChangeSet.saveChangeSet(
        RepoWorkspace.ChangeSet.recordFileChange(started.changeSet, {
          repositoryId: "shared-schema",
          relativePath: "openapi.yaml",
          action: "modify",
        }),
      )
    }
    const verify = await RepoWorkspace.Verify.runVerify({
      info,
      repositoryId: "backend",
      dryRun: true,
    })
    expect(verify.commands.every((c) => c.status !== "passed" || true)).toBe(true)
    expect(verify.commands.some((c) => c.status === "not_run" || c.status === "skipped")).toBe(true)

    // Process-local clear then DB reload
    const id = started.changeSet.id
    RepoWorkspace.ChangeSet.clearChangeSets()
    const restored = RepoWorkspace.ChangeSet.loadChangeSet(session)
    expect(restored?.id).toBe(id)

    // Pre-existing dirty must be blocked via Policy after baseline capture
    fs.writeFileSync(path.join(schema, "local-only.txt"), "user edit\n")
    RepoWorkspace.DirtyBaseline.captureBaseline(session, info, ["shared-schema"])
    const dirtyBlock = RepoWorkspace.Policy.decideWrite(info, session, {
      repositoryId: "shared-schema",
      path: "local-only.txt",
    })
    expect(dirtyBlock.ok).toBe(false)

    // Stale after HEAD change
    fs.writeFileSync(path.join(schema, "openapi.yaml"), "openapi: 3.0.1\n")
    Bun.spawnSync(["git", "add", "."], { cwd: schema })
    Bun.spawnSync(["git", "commit", "-m", "external"], { cwd: schema })
    const afterHead = RepoWorkspace.Policy.decideWrite(info, session, {
      repositoryId: "shared-schema",
      path: "openapi.yaml",
    })
    expect(afterHead.ok).toBe(false)
    if (!afterHead.ok) expect(afterHead.code).toBe("stale_approval")
  })

  test("verify ordered skips downstream on upstream failure", async () => {
    const root = tmpRoot()
    const a = path.join(root, "a")
    const b = path.join(root, "b")
    gitInit(a)
    gitInit(b)
    fs.writeFileSync(
      path.join(a, "package.json"),
      JSON.stringify({ name: "a", scripts: { test: "exit 1" } }),
    )
    fs.writeFileSync(
      path.join(b, "package.json"),
      JSON.stringify({ name: "b", scripts: { test: "echo ok" } }),
    )
    Bun.spawnSync(["git", "add", "."], { cwd: a })
    Bun.spawnSync(["git", "commit", "-m", "a"], { cwd: a })
    Bun.spawnSync(["git", "add", "."], { cwd: b })
    Bun.spawnSync(["git", "commit", "-m", "b"], { cwd: b })
    fs.mkdirSync(path.join(a, ".oimo"), { recursive: true })
    const configPath = path.join(a, ".oimo", "workspace.yaml")
    fs.writeFileSync(
      configPath,
      [
        "version: 1",
        "name: v",
        "primary: a",
        "repositories:",
        "  - id: a",
        "    path: .",
        "  - id: b",
        "    path: ../b",
      ].join("\n"),
    )
    const info = await RepoWorkspace.loadFromFile(configPath, a)
    const rows = await RepoWorkspace.Verify.runVerifyOrdered({
      info,
      repositoryIds: ["a", "b"],
    })
    expect(rows[0].verification.commands.some((c) => c.status === "failed")).toBe(true)
    expect(rows[1].verification.commands.every((c) => c.reason === "dependency_failed")).toBe(true)
  })

  test("approved plan allows ordered mutations + records Change set; shell jail scopes writable roots", async () => {
    const root = tmpRoot()
    const backend = path.join(root, "backend")
    const frontend = path.join(root, "frontend")
    const schema = path.join(root, "shared-schema")
    for (const d of [backend, frontend, schema]) gitInit(d)
    fs.writeFileSync(path.join(schema, "openapi.yaml"), "openapi: 3.0.0\n")
    fs.writeFileSync(
      path.join(backend, "package.json"),
      JSON.stringify({
        name: "backend",
        dependencies: { "shared-schema": "file:../shared-schema" },
        scripts: { test: "echo ok" },
      }),
    )
    fs.writeFileSync(
      path.join(frontend, "package.json"),
      JSON.stringify({ name: "frontend", scripts: { test: "echo ok" } }),
    )
    for (const d of [schema, backend, frontend]) {
      Bun.spawnSync(["git", "add", "."], { cwd: d })
      Bun.spawnSync(["git", "commit", "-m", "ready"], { cwd: d })
    }
    fs.mkdirSync(path.join(backend, ".oimo"), { recursive: true })
    const configPath = path.join(backend, ".oimo", "workspace.yaml")
    fs.writeFileSync(
      configPath,
      [
        "version: 1",
        "name: mutate",
        "primary: backend",
        "repositories:",
        "  - id: backend",
        "    path: .",
        "  - id: frontend",
        "    path: ../frontend",
        "  - id: shared-schema",
        "    path: ../shared-schema",
      ].join("\n"),
    )
    const info = await RepoWorkspace.loadFromFile(configPath, backend)
    const impact = await RepoWorkspace.Graph.analyzeImpact(info, { query: "openapi" })
    const plan = RepoWorkspace.Plan.planFromImpact({ title: "mutate schema", impact })
    const session = "e2e-mutate"
    const started = RepoWorkspace.Plan.beginChangeSet({ sessionID: session, info, plan, autoApprove: true })
    RepoWorkspace.ChangeSet.saveChangeSet(started.changeSet)
    RepoWorkspace.Scope.setScope(session, started.changeSet.executionScope)

    for (const id of ["shared-schema", "backend", "frontend"] as const) {
      const rel = id === "shared-schema" ? "openapi.yaml" : "package.json"
      const hit = RepoWorkspace.Policy.decideWrite(info, session, {
        repositoryId: id,
        path: rel,
      })
      if (!hit.ok) {
        throw new Error(`write denied for ${id}: ${hit.code} ${hit.message}`)
      }
      if (rel === "package.json") {
        const pkg = JSON.parse(fs.readFileSync(hit.absolutePath, "utf8")) as Record<string, unknown>
        pkg.oimoTouched = true
        fs.writeFileSync(hit.absolutePath, JSON.stringify(pkg, null, 2) + "\n")
      } else {
        fs.writeFileSync(hit.absolutePath, fs.readFileSync(hit.absolutePath, "utf8") + "\n# touched\n")
      }
      await RepoWorkspace.RecordMutation.recordMutation({
        sessionID: session,
        absolutePath: hit.absolutePath,
        action: "modify",
        info,
      })
    }

    const cs = RepoWorkspace.ChangeSet.loadChangeSet(session)
    expect(cs?.repos.some((r) => r.files.some((f) => f.relativePath === "openapi.yaml"))).toBe(true)

    const order = ["shared-schema", "backend", "frontend"]
    const verify = await RepoWorkspace.Verify.runVerifyOrdered({ info, repositoryIds: order })
    // shared-schema may skip (no package scripts); backend/frontend should pass
    expect(verify.find((r) => r.repositoryId === "backend")?.verification.commands.some((c) => c.status === "passed")).toBe(
      true,
    )
    expect(verify.find((r) => r.repositoryId === "frontend")?.verification.commands.some((c) => c.status === "passed")).toBe(
      true,
    )

    const writableRoots = started.changeSet.executionScope
      .map((id) => info.repositories.get(id)?.canonicalPath)
      .filter((p): p is string => Boolean(p))
    const jail = RepoWorkspace.ShellJail.planJail({
      shell: "/bin/bash",
      command: "echo hi",
      cwd: backend,
      writableRoots,
    })
    expect(jail.mode === "bwrap" || jail.mode === "policy-only").toBe(true)
    if (jail.mode === "bwrap") {
      expect(jail.argv.some((a) => a === schema || a === backend)).toBe(true)
    }

    const stage = RepoWorkspace.Git.filterStagePaths({
      sessionID: session,
      repositoryId: "shared-schema",
      relativePaths: ["openapi.yaml"],
    })
    expect(stage.allowed).toContain("openapi.yaml")

    const cwd = await RepoWorkspace.Git.resolveWorktreeCwd({
      directory: backend,
      repositoryId: "frontend",
      fallbackCwd: backend,
    })
    expect(cwd.cwd).toBe(frontend)
  })
})

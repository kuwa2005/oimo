import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as RepoWorkspace from "../../src/repo-workspace"

const dirs: string[] = []

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oimo-multirepo-path-"))
  dirs.push(dir)
  return dir
}

function gitInit(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  expect(Bun.spawnSync(["git", "init"], { cwd: dir }).exitCode).toBe(0)
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()
    if (d) fs.rmSync(d, { recursive: true, force: true })
  }
})

describe("RepoWorkspace path adversarial", () => {
  test("rejects .. traversal out of repository via resolveAbsolute", async () => {
    const root = tmpRoot()
    const backend = path.join(root, "backend")
    const frontend = path.join(root, "frontend")
    gitInit(backend)
    gitInit(frontend)
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
    expect(() => RepoWorkspace.resolveAbsolute(info, "backend", "../frontend/secret.txt")).toThrow()
  })

  test("symlink into unregistered path is unregistered for write", async () => {
    const root = tmpRoot()
    const backend = path.join(root, "backend")
    const outside = path.join(root, "outside")
    gitInit(backend)
    fs.mkdirSync(outside, { recursive: true })
    fs.writeFileSync(path.join(outside, "secret.txt"), "nope\n")
    const link = path.join(backend, "leak")
    try {
      fs.symlinkSync(outside, link)
    } catch {
      // some CI FS may disallow symlinks
      return
    }
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
      ].join("\n"),
    )
    const info = await RepoWorkspace.loadFromFile(configPath, backend)
    const target = fs.realpathSync(path.join(link, "secret.txt"))
    const hit = RepoWorkspace.Policy.decideWrite(info, "s", { absolutePath: target })
    expect(hit.ok).toBe(false)
    if (!hit.ok) expect(hit.code).toBe("unregistered")
  })
})

describe("single-repo compatibility", () => {
  test("no workspace config → Runtime.current is undefined (gates fail-open)", async () => {
    const dir = tmpRoot()
    gitInit(dir)
    // Without Instance binding, loadFromPrimary on a plain git dir returns undefined.
    const info = await RepoWorkspace.loadFromPrimary(dir)
    expect(info).toBeUndefined()
  })
})

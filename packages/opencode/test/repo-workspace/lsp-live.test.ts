import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { pathToFileURL } from "url"
import { spawn } from "child_process"
import * as RepoWorkspace from "../../src/repo-workspace"
import { Instance } from "../../src/project/instance"
import { LSPClient } from "../../src/lsp"
import type { LSPServer } from "../../src/lsp"
import { Log } from "../../src/util"

const dirs: string[] = []

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oimo-lsp-live-"))
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
  RepoWorkspace.Runtime.invalidate()
  while (dirs.length) {
    const d = dirs.pop()
    if (d) fs.rmSync(d, { recursive: true, force: true })
  }
})

describe("live LSP multi-root (fake language server)", () => {
  test("definition into sibling repo is annotated as repo-id:path", async () => {
    await Log.init({ print: false })
    const root = tmpRoot()
    const backend = path.join(root, "backend")
    const frontend = path.join(root, "frontend")
    gitInit(backend)
    gitInit(frontend)
    fs.mkdirSync(path.join(backend, "src"), { recursive: true })
    fs.mkdirSync(path.join(frontend, "src"), { recursive: true })
    const beFile = path.join(backend, "src", "App.tsx")
    const feFile = path.join(frontend, "src", "App.tsx")
    fs.writeFileSync(beFile, "export const App = () => null\n")
    fs.writeFileSync(feFile, "export const App = () => null\n")
    fs.mkdirSync(path.join(backend, ".oimo"), { recursive: true })
    const configPath = path.join(backend, ".oimo", "workspace.yaml")
    fs.writeFileSync(
      configPath,
      [
        "version: 1",
        "name: lsp-live",
        "primary: backend",
        "repositories:",
        "  - id: backend",
        "    path: .",
        "  - id: frontend",
        "    path: ../frontend",
      ].join("\n"),
    )
    const info = await RepoWorkspace.loadFromFile(configPath, backend)

    const serverPath = path.join(import.meta.dir, "../fixture/lsp/fake-lsp-server.js")
    const handle = {
      process: spawn(process.execPath, [serverPath], {
        stdio: "pipe",
        env: {
          ...process.env,
          FAKE_LSP_DEFINITION_URI: pathToFileURL(feFile).href,
        },
      }),
    }

    const client = await Instance.provide({
      directory: backend,
      fn: () =>
        LSPClient.create({
          serverID: "fake-multi",
          server: handle as unknown as LSPServer.Handle,
          root: backend,
          directory: backend,
        }),
    })

    const raw = await client.connection.sendRequest("textDocument/definition", {
      textDocument: { uri: pathToFileURL(beFile).href },
      position: { line: 0, character: 16 },
    })
    expect(raw).toBeTruthy()
    expect((raw as { uri: string }).uri).toBe(pathToFileURL(feFile).href)

    const annotated = RepoWorkspace.Policy.annotatePaths(info, raw, backend) as { uri: string }
    expect(annotated.uri).toBe("frontend:src/App.tsx")

    await client.shutdown()
  })
})

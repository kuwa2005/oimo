import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import fs from "fs"
import path from "path"
import os from "os"

const SCRIPT_PATH = path.join(import.meta.dirname, "../../script/postinstall.mjs")

describe("postinstall", () => {
  const platform = os.platform() === "win32" ? "windows" : os.platform() === "darwin" ? "darwin" : "linux"
  const arch = os.arch()
  const binaryName = platform === "windows" ? "oimo.exe" : "oimo"
  const packageName = `@mimo-ai/oimo-${platform}-${arch}`

  test("creates .oimo binary cache from platform package", async () => {
    await using tmp = await tmpdir()
    const dir = tmp.path

    const binDir = path.join(dir, "bin")
    fs.mkdirSync(binDir)

    const pkgBinDir = path.join(dir, "node_modules", packageName, "bin")
    fs.mkdirSync(pkgBinDir, { recursive: true })
    fs.writeFileSync(path.join(dir, "node_modules", packageName, "package.json"), JSON.stringify({ name: packageName }))

    const fakeBinary = Buffer.from("FAKE_BINARY_CONTENT")
    fs.writeFileSync(path.join(pkgBinDir, binaryName), fakeBinary)

    fs.copyFileSync(SCRIPT_PATH, path.join(dir, "postinstall.mjs"))

    const result = Bun.spawnSync(["node", "postinstall.mjs"], {
      cwd: dir,
      env: { ...process.env, NODE_PATH: path.join(dir, "node_modules") },
    })

    expect(result.exitCode).toBe(0)

    const cached = path.join(binDir, ".oimo")
    expect(fs.existsSync(cached)).toBe(true)
    expect(fs.readFileSync(cached)).toEqual(fakeBinary)
  })

  test("prints migration notice to stdout", async () => {
    await using tmp = await tmpdir()
    const dir = tmp.path

    const binDir = path.join(dir, "bin")
    fs.mkdirSync(binDir)
    const pkgBinDir = path.join(dir, "node_modules", packageName, "bin")
    fs.mkdirSync(pkgBinDir, { recursive: true })
    fs.writeFileSync(path.join(dir, "node_modules", packageName, "package.json"), JSON.stringify({ name: packageName }))
    fs.writeFileSync(path.join(pkgBinDir, binaryName), "binary")

    fs.copyFileSync(SCRIPT_PATH, path.join(dir, "postinstall.mjs"))

    const result = Bun.spawnSync(["node", "postinstall.mjs"], {
      cwd: dir,
      env: { ...process.env, NODE_PATH: path.join(dir, "node_modules") },
    })

    const stdout = result.stdout.toString()
    expect(stdout).toContain("This package path is not used by kuwa2005/oimo")
    expect(stdout).toContain("Install from GitHub Releases")
    expect(stdout).toContain(os.platform() === "win32" ? "    irm" : "    curl")
  })

  test("exits with error when binary package is missing", async () => {
    await using tmp = await tmpdir()
    const dir = tmp.path

    fs.mkdirSync(path.join(dir, "bin"))
    fs.copyFileSync(SCRIPT_PATH, path.join(dir, "postinstall.mjs"))

    const result = Bun.spawnSync(["node", "postinstall.mjs"], {
      cwd: dir,
      env: { ...process.env, NODE_PATH: path.join(dir, "node_modules") },
    })

    expect(result.exitCode).toBe(1)
    expect(result.stdout.toString()).toContain("Install from GitHub Releases")
  })

  test("skips binary cache on windows but still prints notice", () => {
    const source = fs.readFileSync(SCRIPT_PATH, "utf8")
    const mainBody = source.slice(source.indexOf("async function main()"))
    // Windows skip must come AFTER printMigrationNotice()
    const noticeIdx = mainBody.indexOf("printMigrationNotice()")
    const winCheckIdx = mainBody.indexOf("os.platform() === \"win32\"")
    expect(noticeIdx).toBeGreaterThan(-1)
    expect(winCheckIdx).toBeGreaterThan(noticeIdx)
  })
})

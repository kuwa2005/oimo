import { afterAll, describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "node:path"
import { sha256Sums } from "../../../../script/checksums.ts"
import { bumpVersions } from "../../../../script/bump-version.ts"
import { renderChangelog } from "../../../../script/changelog.ts"
import { tmpdir } from "../fixture/fixture"

const ROOT = path.resolve(import.meta.dir, "../../../..")

const servers: ReturnType<typeof Bun.serve>[] = []
afterAll(() => {
  for (const server of servers) server.stop(true)
})

function serveFiles(files: Record<string, string | Uint8Array<ArrayBuffer>>) {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const body = files[new URL(req.url).pathname]
      if (body === undefined) return new Response("not found", { status: 404 })
      return new Response(body)
    },
  })
  servers.push(server)
  return `http://127.0.0.1:${server.port}`
}

async function makeStubArchive(dir: string): Promise<Uint8Array<ArrayBuffer>> {
  const binDir = path.join(dir, "stub")
  await Bun.write(path.join(binDir, "oimo"), "#!/usr/bin/env bash\necho fake oimo\n")
  const tarPath = path.join(dir, "oimo-linux-x64.tar.gz")
  await $`tar -czf ${tarPath} -C ${binDir} oimo`
  return new Uint8Array(await Bun.file(tarPath).arrayBuffer())
}

function sumsFor(bytes: Uint8Array, names: string[]): string {
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
  return `${names.map((name) => `${hash}  ${name}`).join("\n")}\n`
}

async function runInstaller(base: string, home: string) {
  const proc = Bun.spawn(["bash", path.join(ROOT, "install"), "--version", "0.0.0-test", "--no-modify-path"], {
    cwd: ROOT,
    env: { ...process.env, OIMO_BASE_URL: base, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const exit = await proc.exited
  return { stdout, stderr, exit }
}

describe("T1: checksums unit", () => {
  test("emits '<hex>  <name>' lines sorted by filename with correct hashes", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "b.txt"), "world")
    await Bun.write(path.join(tmp.path, "a.txt"), "hello")
    const sums = await sha256Sums([path.join(tmp.path, "b.txt"), path.join(tmp.path, "a.txt")])
    const lines = sums.trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(`${new Bun.CryptoHasher("sha256").update("hello").digest("hex")}  a.txt`)
    expect(lines[1]).toBe(`${new Bun.CryptoHasher("sha256").update("world").digest("hex")}  b.txt`)
  })

  test("bumpVersions rewrites package.json files and skips node_modules/dist", async () => {
    await using tmp = await tmpdir()
    await Bun.write(path.join(tmp.path, "package.json"), JSON.stringify({ name: "root", version: "0.1.0" }))
    await Bun.write(path.join(tmp.path, "sub", "package.json"), JSON.stringify({ name: "sub", version: "0.1.0" }))
    await Bun.write(
      path.join(tmp.path, "node_modules", "x", "package.json"),
      JSON.stringify({ name: "x", version: "9.9.9" }),
    )
    await Bun.write(path.join(tmp.path, "dist", "package.json"), JSON.stringify({ name: "d", version: "9.9.9" }))
    const changed = await bumpVersions("2.0.0", tmp.path)
    expect(changed).toHaveLength(2)
    expect(JSON.parse(await Bun.file(path.join(tmp.path, "package.json")).text()).version).toBe("2.0.0")
    expect(JSON.parse(await Bun.file(path.join(tmp.path, "sub", "package.json")).text()).version).toBe("2.0.0")
    expect(JSON.parse(await Bun.file(path.join(tmp.path, "node_modules", "x", "package.json")).text()).version).toBe(
      "9.9.9",
    )
    expect(JSON.parse(await Bun.file(path.join(tmp.path, "dist", "package.json")).text()).version).toBe("9.9.9")
  })
})

describe("T2-T4: installer end-to-end (fake release server + OIMO_BASE_URL)", () => {
  const names = ["oimo-linux-x64.tar.gz", "oimo-linux-x64-baseline.tar.gz"]

  test("T2: installs and verifies checksum on the golden path", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const bytes = await makeStubArchive(tmp.path)
    const base = serveFiles({
      "/releases/download/v0.0.0-test/oimo-linux-x64.tar.gz": bytes,
      "/releases/download/v0.0.0-test/oimo-linux-x64-baseline.tar.gz": bytes,
      "/releases/download/v0.0.0-test/SHA256SUMS": sumsFor(bytes, names),
    })
    const { stdout, stderr, exit } = await runInstaller(base, home)
    expect(exit).toBe(0)
    expect(stdout + stderr).toContain("Checksum verified")
    expect(await Bun.file(path.join(home, ".oimo", "bin", "oimo")).exists()).toBe(true)
  })

  test("T3: aborts with exit 1 on checksum mismatch", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const good = await makeStubArchive(tmp.path)
    const tampered = new Uint8Array(good.byteLength + 1)
    tampered.set(good)
    tampered[good.byteLength] = 0x42
    const base = serveFiles({
      "/releases/download/v0.0.0-test/oimo-linux-x64.tar.gz": tampered,
      "/releases/download/v0.0.0-test/oimo-linux-x64-baseline.tar.gz": tampered,
      "/releases/download/v0.0.0-test/SHA256SUMS": sumsFor(good, names),
    })
    const { stdout, stderr, exit } = await runInstaller(base, home)
    expect(exit).not.toBe(0)
    expect(stdout + stderr).toContain("checksum mismatch")
    expect(await Bun.file(path.join(home, ".oimo", "bin", "oimo")).exists()).toBe(false)
  })

  test("T4: warns and continues when SHA256SUMS is absent (backward compat)", async () => {
    await using tmp = await tmpdir()
    const home = path.join(tmp.path, "home")
    const bytes = await makeStubArchive(tmp.path)
    const base = serveFiles({
      "/releases/download/v0.0.0-test/oimo-linux-x64.tar.gz": bytes,
      "/releases/download/v0.0.0-test/oimo-linux-x64-baseline.tar.gz": bytes,
    })
    const { stdout, stderr, exit } = await runInstaller(base, home)
    expect(exit).toBe(0)
    expect(stdout + stderr).toContain("skipping checksum verification")
    expect(await Bun.file(path.join(home, ".oimo", "bin", "oimo")).exists()).toBe(true)
  })
})

describe("T5: release.yml static checks", () => {
  test("defines the tag-triggered release pipeline (v* tags, matrix, softprops, no npm)", async () => {
    const yaml = await Bun.file(path.join(ROOT, ".github", "workflows", "release.yml")).text()
    expect(yaml).toContain('"v*"')
    expect(yaml).toContain("contents: write")
    expect(yaml).toContain("MIMOCODE_VERSION")
    expect(yaml).toContain("MIMOCODE_RELEASE")
    expect(yaml).toContain("MIMOCODE_SKIP_UPLOAD")
    expect(yaml).toContain("GH_REPO")
    expect(yaml).toContain("packages/opencode/script/build.ts")
    expect(yaml).toContain("softprops/action-gh-release@v2")
    expect(yaml).toContain("does not publish to npm")
    expect(yaml).not.toContain("script/publish.ts")
    expect(yaml).not.toContain('if [ -z "$NPM_TOKEN" ]')
    expect(yaml).not.toContain("script/version.ts")
  })
})

describe("T6: install.ps1 regeneration determinism", () => {
  test("build-install-ps1.ts reproduces the committed install.ps1 byte-for-byte", async () => {
    const ps1 = path.join(ROOT, "install.ps1")
    const before = await Bun.file(ps1).text()
    const proc = Bun.spawn([process.execPath, "script/build-install-ps1.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    })
    const exit = await proc.exited
    expect(exit).toBe(0)
    const after = await Bun.file(ps1).text()
    expect(after).toBe(before)
    expect(after).toContain("Get-FileHash")
    expect(after).toContain("OIMO_BASE_URL")
    expect(after).toContain("SHA256SUMS")
  })
})

describe("T7: changelog render unit", () => {
  test("groups conventional commits by type and falls back to Other", () => {
    const out = renderChangelog([
      "feat(tui): add --auto flag",
      "fix: start new session",
      "docs: expand help",
      "chore: bump actions",
      "random line",
    ])
    expect(out).toContain("### Features")
    expect(out).toContain("- add --auto flag")
    expect(out).toContain("### Fixes")
    expect(out).toContain("- start new session")
    expect(out).toContain("### Docs")
    expect(out).toContain("- expand help")
    expect(out).toContain("### Other")
    expect(out).toContain("- random line")
  })

  test("strips the conventional-commit prefix including scope", () => {
    const out = renderChangelog(["perf(core): cache file reads"])
    expect(out).toContain("- cache file reads")
    expect(out).not.toContain("perf(core)")
  })

  test("renders 'No notable changes' for empty input", () => {
    expect(renderChangelog([])).toContain("No notable changes")
  })
})

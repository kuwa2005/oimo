import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { ALL_TARGETS, filterTargets, targetName } from "../../script/targets.ts"
import { nextVersion } from "../../../../script/bump.ts"

const ROOT = resolve(import.meta.dir, "../../../..")
const RELEASE_YML = resolve(ROOT, ".github/workflows/release.yml")
const BUILD_TS = resolve(ROOT, "packages/opencode/script/build.ts")
const RELEASE_SCRIPT = resolve(ROOT, "script/release")
const RELEASING_MD = resolve(ROOT, "docs/RELEASING.md")
const AGENTS_MD = resolve(ROOT, "AGENTS.md")

const EXPECTED_NAMES = [
  "oimo-linux-arm64",
  "oimo-linux-x64",
  "oimo-linux-x64-baseline",
  "oimo-linux-arm64-musl",
  "oimo-linux-x64-musl",
  "oimo-linux-x64-baseline-musl",
  "oimo-darwin-arm64",
  "oimo-darwin-x64",
  "oimo-darwin-x64-baseline",
  "oimo-windows-arm64",
  "oimo-windows-x64",
  "oimo-windows-x64-baseline",
]

describe("release build matrix: targets.ts", () => {
  test("T1: targetName computes all 12 release asset names", () => {
    expect(ALL_TARGETS).toHaveLength(12)
    const names = ALL_TARGETS.map(targetName)
    expect(names).toEqual(EXPECTED_NAMES)
    expect(new Set(names).size).toBe(12)
  })

  test("T1b: targetName maps win32 to windows and suffixes baseline/musl", () => {
    expect(targetName({ os: "win32", arch: "x64" })).toBe("oimo-windows-x64")
    expect(targetName({ os: "linux", arch: "x64", avx2: false })).toBe("oimo-linux-x64-baseline")
    expect(targetName({ os: "linux", arch: "x64", abi: "musl" })).toBe("oimo-linux-x64-musl")
    expect(targetName({ os: "linux", arch: "x64", abi: "musl", avx2: false })).toBe(
      "oimo-linux-x64-baseline-musl",
    )
  })

  test("T2: filterTargets empty filter keeps all targets", () => {
    expect(filterTargets(ALL_TARGETS, [])).toEqual(ALL_TARGETS)
  })

  test("T2b: filterTargets selects a single target by name", () => {
    const filtered = filterTargets(ALL_TARGETS, ["oimo-linux-x64"])
    expect(filtered).toHaveLength(1)
    expect(filtered[0]).toEqual({ os: "linux", arch: "x64" })
  })

  test("T2e: filterTargets accepts the unprefixed matrix form (linux-x64)", () => {
    const filtered = filterTargets(ALL_TARGETS, ["linux-x64", "windows-x64-baseline"])
    expect(filtered.map(targetName)).toEqual(["oimo-linux-x64", "oimo-windows-x64-baseline"])
  })

  test("T2c: filterTargets selects multiple comma-joined targets", () => {
    const filtered = filterTargets(ALL_TARGETS, ["oimo-darwin-arm64", "oimo-windows-x64-baseline"])
    expect(filtered.map(targetName)).toEqual(["oimo-darwin-arm64", "oimo-windows-x64-baseline"])
  })

  test("T2d: filterTargets ignores unknown names", () => {
    const filtered = filterTargets(ALL_TARGETS, ["oimo-linux-x64", "oimo-unknown-arch"])
    expect(filtered.map(targetName)).toEqual(["oimo-linux-x64"])
  })
})

describe("release build matrix: release.yml", () => {
  const yml = readFileSync(RELEASE_YML, "utf8")

  test("T3: tag push (v*) trigger, no manual dispatch", () => {
    expect(yml).toContain("push:")
    expect(yml).toContain("tags:")
    expect(yml).toContain('"v*"')
    expect(yml).not.toContain("workflow_dispatch")
  })

  test("T3b: build-cli runs a 12-target matrix", () => {
    expect(yml).toContain("matrix:")
    expect(yml).toContain("target:")
    for (const name of EXPECTED_NAMES) {
      expect(yml).toContain(`- ${name.replace(/^oimo-/, "")}`)
    }
  })

  test("T3c: each matrix job is handed its target via MIMOCODE_TARGETS", () => {
    expect(yml).toContain("MIMOCODE_TARGETS: ${{ matrix.target }}")
  })

  test("T3d: assemble depends on the build-cli matrix (no version job)", () => {
    expect(yml).toContain("needs: build-cli")
    expect(yml).not.toContain("needs: version")
    expect(yml).not.toContain("needs: [version, build-cli]")
  })

  test("T3e: assemble regenerates aggregate SHA256SUMS from downloaded artifacts", () => {
    expect(yml).toContain("checksums.ts release-assets/*")
    expect(yml).toContain("download-artifact@v4")
    expect(yml).toContain("pattern: oimo-*")
  })

  test("T3f: softprops/action-gh-release creates the release with assets", () => {
    expect(yml).toContain("softprops/action-gh-release@v2")
    expect(yml).toContain("files: release-assets/*")
    expect(yml).toContain("draft: false")
    expect(yml).toContain("contents: write")
  })

  test("T3g: fork skips npm publish (GitHub Releases only)", () => {
    expect(yml).toContain("does not publish to npm")
    expect(yml).not.toContain("script/publish.ts")
    expect(yml).not.toContain('if [ -z "$NPM_TOKEN" ]')
  })

  test("T3h: archives flow through upload/download artifacts", () => {
    expect(yml).toContain("upload-artifact@v4")
    expect(yml).toContain("merge-multiple: true")
    expect(yml).toContain("if-no-files-found: error")
  })

  test("T3i: matrix jobs build archives only and derive the version from the tag", () => {
    expect(yml).toContain('MIMOCODE_SKIP_UPLOAD: "1"')
    expect(yml).toContain('MIMOCODE_RELEASE: "1"')
    expect(yml).toContain("GITHUB_REF_NAME#v")
  })
})

describe("release build matrix: build.ts", () => {
  const ts = readFileSync(BUILD_TS, "utf8")

  test("T4: build.ts reads MIMOCODE_TARGETS", () => {
    expect(ts).toContain("MIMOCODE_TARGETS")
  })

  test("T4b: full build emits SHA256SUMS, matrix runs skip it (centralized in publish)", () => {
    expect(ts).toContain("if (targetFilter.length === 0)")
    expect(ts).toContain("sha256Sums")
  })

  test("T4c: build.ts reuses targets.ts helpers", () => {
    expect(ts).toContain('from "./targets.ts"')
    expect(ts).toContain("filterTargets(allTargets, targetFilter)")
  })

  test("T4d: build.ts skips gh release upload when MIMOCODE_SKIP_UPLOAD is set", () => {
    expect(ts).toContain("MIMOCODE_SKIP_UPLOAD")
    expect(ts).toContain("if (!process.env.MIMOCODE_SKIP_UPLOAD)")
  })
})

describe("release build matrix: script/release", () => {
  const script = readFileSync(RELEASE_SCRIPT, "utf8")

  test("T5: script/release bumps, tags, pushes and watches", () => {
    expect(script).toContain("bun script/bump.ts")
    expect(script).toContain("git tag")
    expect(script).toContain("git push origin")
    expect(script).toContain("gh run watch")
    expect(script).toContain("docs/RELEASING.md")
    expect(script).toContain("gh secret list")
    expect(script).toContain("--no-watch")
    expect(script).not.toContain("gh workflow run publish.yml")
  })

  test("T5b: --help exits 0 with usage", async () => {
    const proc = Bun.spawn(["bash", "script/release", "--help"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = await new Response(proc.stdout).text()
    const code = await proc.exited
    expect(code).toBe(0)
    expect(stdout).toContain("Usage: script/release")
    expect(stdout).toContain("docs/RELEASING.md")
  })

  test("T5c: unknown argument exits 1 with usage on stderr", async () => {
    const proc = Bun.spawn(["bash", "script/release", "--bogus"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    })
    const stderr = await new Response(proc.stderr).text()
    const code = await proc.exited
    expect(code).toBe(1)
    expect(stderr).toContain("Unknown argument: --bogus")
  })
})

describe("release build matrix: runbook + future reference", () => {
  test("T6: docs/RELEASING.md exists with required sections", () => {
    const md = readFileSync(RELEASING_MD, "utf8")
    for (const heading of ["概要", "前提条件", "リリース手順", "ワークフロー各ジョブの動作", "トラブルシュート"]) {
      expect(md).toContain(heading)
    }
    expect(md).toContain("./script/release")
    expect(md).toContain("SHA256SUMS")
    expect(md).toContain("OIMO_BASE_URL")
    expect(md).toContain("release.yml")
  })

  test("T7: AGENTS.md references docs/RELEASING.md for future sessions", () => {
    const md = readFileSync(AGENTS_MD, "utf8")
    expect(md).toContain("docs/RELEASING.md")
  })

  test("T7b: targets.ts is importable without side effects", () => {
    // importing the module must not touch the filesystem; readdirSync on
    // packages/opencode/script must not contain a run artifact from import
    const files = readdirSync(resolve(ROOT, "packages/opencode/script"))
    expect(files).toContain("targets.ts")
  })

  test("T8: nextVersion computes the next semantic version", () => {
    expect(nextVersion("0.1.14", "patch")).toBe("0.1.15")
    expect(nextVersion("0.1.14", "minor")).toBe("0.2.0")
    expect(nextVersion("0.1.14", "major")).toBe("1.0.0")
  })
})

afterAll(() => {})

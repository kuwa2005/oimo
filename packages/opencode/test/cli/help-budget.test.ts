import { describe, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"

const ROOT = path.join(import.meta.dir, "..", "..")

/** Product target (FDE/SE §11.2). */
const HELP_TARGET_MS = 1_000
/** Catastrophic regression guard (migrations mixed into every help, hangs). */
const HELP_REGRESSION_MS = 20_000

async function runHelp(home: string) {
  const proc = Bun.spawn([process.execPath, "src/index.ts", "--help"], {
    cwd: ROOT,
    env: { ...process.env, MIMOCODE_HOME: home, MIMOCODE_DISABLE_CLAUDE_IMPORT: "1", NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

describe("CLI help performance budget", () => {
  test("warm help exits 0 under 1s product target", async () => {
    await using tmp = await tmpdir()
    const warm = await runHelp(tmp.path)
    expect(warm.exitCode).toBe(0)

    const started = performance.now()
    const result = await runHelp(tmp.path)
    const elapsed = performance.now() - started
    expect(result.exitCode).toBe(0)
    expect(result.stdout.length + result.stderr.length).toBeGreaterThan(20)
    expect(elapsed).toBeLessThan(HELP_REGRESSION_MS)
    expect(elapsed).toBeLessThan(HELP_TARGET_MS)
  }, 120_000)
})

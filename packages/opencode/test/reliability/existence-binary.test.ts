import { describe, expect, test } from "bun:test"
import * as Existence from "../../src/reliability/existence"

describe("existence binary pre-flight", () => {
  test("flags missing sqlite3 on PATH", () => {
    const findings = Existence.checkCommand("sqlite3 .data/app.db '.tables'", {
      cwd: "/tmp",
      scripts: new Set(),
      exists: () => true,
      onPath: (name) => name !== "sqlite3",
    })
    expect(findings.some((f) => f.kind === "missing_binary" && f.claim === "sqlite3")).toBe(true)
  })
})

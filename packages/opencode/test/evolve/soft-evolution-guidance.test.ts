import { describe, expect, test } from "bun:test"
import path from "path"

const repo = path.join(import.meta.dir, "../..")

describe("soft evolution guidance (Phase 5)", () => {
  test("builtin evolve SKILL encodes INDEX derivation and global source", async () => {
    const skill = await Bun.file(
      path.join(repo, "src/skill/builtin/.bundle/evolve/SKILL.md"),
    ).text()
    expect(skill).toContain("Status:")
    expect(skill).toContain("Generated from brief files at")
    expect(skill).toContain("Owner")
    expect(skill).toContain("window label")
    expect(skill).toContain("source: global")
  })

  test("evolve agent prompt encodes R-07 and R-11 handoff fields", async () => {
    const prompt = await Bun.file(path.join(repo, "src/agent/prompt/evolve.txt")).text()
    expect(prompt).toContain("INDEX derivation")
    expect(prompt).toContain("Owner")
    expect(prompt).toContain("Verification command")
    expect(prompt).toContain("window label")
  })

  test("brief template requires Owner and Verification", async () => {
    const tpl = await Bun.file(
      path.join(repo, "src/skill/builtin/.bundle/evolve/reference/brief-template.md"),
    ).text()
    expect(tpl).toContain("Owner:")
    expect(tpl).toContain("Verification:")
  })

  test("backlog reference includes hygiene rules", async () => {
    const backlog = await Bun.file(
      path.join(repo, "src/skill/builtin/.bundle/evolve/reference/backlog.md"),
    ).text()
    expect(backlog).toContain("Backlog hygiene")
    expect(backlog).toContain("window")
  })
})

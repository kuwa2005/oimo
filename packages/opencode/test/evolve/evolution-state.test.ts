import { describe, expect, test } from "bun:test"
import path from "path"
import os from "os"
import fs from "fs"
import { EvolutionState, EvolutionWritePolicy, EvolveStore } from "../../src/evolve"
import { Global } from "../../src/global"

describe("EvolutionState", () => {
  test("create → transition → audit round-trip", () => {
    const evo = EvolutionState.createEvolution({
      projectID: "proj-evo-state",
      kind: "soft",
      title: "test soft",
      evidenceIDs: ["ev1"],
    })
    expect(evo.status).toBe("observed")
    expect(evo.id.startsWith("evo_")).toBe(true)

    const cand = EvolutionState.transition({ id: evo.id, to: "candidate" })
    expect(cand.status).toBe("candidate")

    expect(() => EvolutionState.transition({ id: evo.id, to: "accepted" })).toThrow(/illegal/)

    const planned = EvolutionState.transition({ id: evo.id, to: "planned" })
    expect(planned.status).toBe("planned")

    const audit = EvolutionState.listAudit(evo.id)
    expect(audit.length).toBeGreaterThanOrEqual(3)
    expect(audit.some((a) => a.type === "created")).toBe(true)
    expect(audit.some((a) => a.type === "transition")).toBe(true)

    const listed = EvolutionState.listEvolutions("proj-evo-state")
    expect(listed.some((x) => x.id === evo.id)).toBe(true)
  })

  test("non-overlapping evaluation windows", () => {
    const ok = EvolutionState.assertNonOverlappingWindows(
      { windowStartMs: 0, windowEndMs: 100, sampleSize: 2 },
      { windowStartMs: 100, windowEndMs: 200, sampleSize: 2 },
    )
    expect(ok.ok).toBe(true)
    const bad = EvolutionState.assertNonOverlappingWindows(
      { windowStartMs: 0, windowEndMs: 150, sampleSize: 2 },
      { windowStartMs: 100, windowEndMs: 200, sampleSize: 2 },
    )
    expect(bad.ok).toBe(false)
  })
})

describe("EvolutionWritePolicy", () => {
  test("allows memory and project evolve home; denies cross-project and source", () => {
    const projectID = "proj-write-pol"
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "oimo-evo-wt-"))
    fs.mkdirSync(path.join(worktree, ".oimo", "skills"), { recursive: true })
    const home = EvolveStore.evolveRoot(projectID)
    fs.mkdirSync(path.join(home, "briefs"), { recursive: true })

    const mem = EvolutionWritePolicy.decideEvolveWrite({
      projectID,
      worktree,
      absolutePath: path.join(Global.Path.data, "memory", "x.md"),
      track: "dream",
    })
    expect(mem.ok).toBe(true)

    const brief = EvolutionWritePolicy.decideEvolveWrite({
      projectID,
      worktree,
      absolutePath: path.join(home, "briefs", "a.md"),
      track: "hard-brief",
    })
    expect(brief.ok).toBe(true)

    const other = EvolutionWritePolicy.decideEvolveWrite({
      projectID,
      worktree,
      absolutePath: path.join(EvolveStore.evolveHome(), "other-project", "briefs", "x.md"),
      track: "evolve",
    })
    expect(other.ok).toBe(false)
    if (!other.ok) expect(other.code).toBe("cross_project_evolve")

    const src = EvolutionWritePolicy.decideEvolveWrite({
      projectID,
      worktree,
      absolutePath: path.join(worktree, "packages", "opencode", "src", "index.ts"),
      track: "evolve",
    })
    expect(src.ok).toBe(false)

    const skill = EvolutionWritePolicy.decideEvolveWrite({
      projectID,
      worktree,
      absolutePath: path.join(worktree, ".oimo", "skills", "foo", "SKILL.md"),
      track: "distill",
    })
    expect(skill.ok).toBe(true)

    const dreamOimo = EvolutionWritePolicy.decideEvolveWrite({
      projectID,
      worktree,
      absolutePath: path.join(worktree, ".oimo", "skills", "foo", "SKILL.md"),
      track: "dream",
    })
    expect(dreamOimo.ok).toBe(false)
  })
})

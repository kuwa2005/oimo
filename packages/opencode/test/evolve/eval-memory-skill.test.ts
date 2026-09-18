import { describe, expect, test } from "bun:test"
import path from "path"
import os from "os"
import fs from "fs/promises"
import { compareFriction, compareFrictionWindows } from "../../src/evolve/evaluate"
import type { FrictionMetrics } from "../../src/evolve/metrics"
import {
  EvolutionMemoryEntry,
  EvolutionSkillStaging,
} from "../../src/evolve"

function metrics(partial: Partial<FrictionMetrics>): FrictionMetrics {
  return {
    windowDays: 7,
    cutoffMs: 0,
    sessions: 10,
    userTurns: 20,
    assistantTurns: 40,
    toolCalls: 100,
    toolByName: [],
    readReplays: [],
    correctionHints: 4,
    humanAttentionCost: { score: 20, level: "medium", drivers: [] },
    ...partial,
  }
}

describe("normalized friction compare", () => {
  test("usage collapse is inconclusive (not improvement)", () => {
    const cmp = compareFriction(
      metrics({ sessions: 20, toolCalls: 400, correctionHints: 10 }),
      metrics({ sessions: 2, toolCalls: 10, correctionHints: 0, humanAttentionCost: { score: 1, level: "low", drivers: [] } }),
    )
    expect(cmp.verdict).toBe("inconclusive")
    expect(cmp.notes.join(" ")).toContain("sample size collapsed")
  })

  test("rate improvement with stable sample → pass", () => {
    const cmp = compareFriction(
      metrics({
        sessions: 10,
        userTurns: 20,
        toolCalls: 200,
        correctionHints: 10,
        assistantTurns: 100,
        humanAttentionCost: { score: 40, level: "high", drivers: [] },
      }),
      metrics({
        sessions: 10,
        userTurns: 20,
        toolCalls: 80,
        correctionHints: 2,
        assistantTurns: 40,
        humanAttentionCost: { score: 10, level: "low", drivers: [] },
      }),
    )
    expect(cmp.normalized).toBe(true)
    expect(cmp.verdict).toBe("pass")
  })

  test("overlapping windows → inconclusive", () => {
    const cmp = compareFrictionWindows({
      before: metrics({}),
      after: metrics({ toolCalls: 50 }),
      beforeWindow: { windowStartMs: 0, windowEndMs: 100, sampleSize: 5 },
      afterWindow: { windowStartMs: 50, windowEndMs: 150, sampleSize: 5 },
    })
    expect(cmp.verdict).toBe("inconclusive")
  })
})

describe("memory provenance", () => {
  test("rejects speculation without evidence and volatile facts", () => {
    const bad = EvolutionMemoryEntry.validateMemoryEntry({
      statement: "probably the HEAD tip is broken",
      scope: "project",
      evidenceIDs: [],
      confidence: 0.9,
    })
    expect(bad.ok).toBe(false)

    const ok = EvolutionMemoryEntry.validateMemoryEntry({
      statement: "API retries use exponential backoff with jitter",
      scope: "project",
      evidenceIDs: ["evd_1"],
      confidence: 0.8,
    })
    expect(ok.ok).toBe(true)
  })

  test("mergeOrDispute marks conflicts", () => {
    const a = EvolutionMemoryEntry.validateMemoryEntry({
      id: "a",
      statement: "use bun test from packages/opencode",
      scope: "project",
      evidenceIDs: ["e1"],
      confidence: 0.7,
    })
    const b = EvolutionMemoryEntry.validateMemoryEntry({
      id: "b",
      statement: "always run tests from repo root",
      scope: "project",
      evidenceIDs: ["e2"],
      confidence: 0.6,
    })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      const r = EvolutionMemoryEntry.mergeOrDispute(a.entry, b.entry)
      expect(r.action).toBe("dispute")
      expect(r.entry.status).toBe("disputed")
    }
  })
})

describe("skill staging", () => {
  test("stage then activate; refuse invalid skill", async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "oimo-skill-stage-"))
    const bad = await EvolutionSkillStaging.stageSkill({
      worktree,
      skillName: "bad",
      files: { "SKILL.md": "# no frontmatter\n" },
    })
    expect(bad.ok).toBe(false)

    const good = await EvolutionSkillStaging.stageSkill({
      worktree,
      skillName: "good",
      files: {
        "SKILL.md": "---\nname: good\ndescription: does a thing safely\n---\n\n# Good\n",
      },
    })
    expect(good.ok).toBe(true)
    if (good.ok) {
      const act = await EvolutionSkillStaging.activateStagedSkill({ worktree, skillName: "good" })
      expect(act.ok).toBe(true)
      const active = await fs.readFile(path.join(worktree, ".oimo", "skills", "good", "SKILL.md"), "utf8")
      expect(active).toContain("name: good")
    }
  })
})

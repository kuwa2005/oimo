import { describe, expect, test } from "bun:test"
import path from "path"
import os from "os"
import fs from "fs/promises"
import {
  EvolutionSoftLoop,
  EvolutionHardLoop,
  EvolutionCandidateRouter,
  EvolutionKnowledgeScope,
  EvolutionObserveTrace,
  EvolutionWritePolicy,
  EvolveStore,
  EvolveScenario,
} from "../../src/evolve"
import { BUILTIN_SCENARIOS } from "../../src/evolve/scenarios/builtin"
import type { FrictionMetrics } from "../../src/evolve/metrics"
import * as ChangeSet from "../../src/repo-workspace/change-set"

function metrics(partial: Partial<FrictionMetrics>): FrictionMetrics {
  return {
    windowDays: 7,
    cutoffMs: 0,
    sessions: 10,
    userTurns: 20,
    assistantTurns: 40,
    toolCalls: 200,
    toolByName: [],
    readReplays: [],
    correctionHints: 10,
    humanAttentionCost: { score: 40, level: "high", drivers: [] },
    ...partial,
  }
}

describe("soft evolution E2E", () => {
  test("evidence → stage → gate pass → activate → rollback", async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "oimo-soft-e2e-"))
    await fs.mkdir(path.join(worktree, ".oimo", "skills"), { recursive: true })
    const projectID = `soft-e2e-${Date.now()}`

    const scenario = EvolveScenario.scoreScenario(BUILTIN_SCENARIOS.find((s) => s.id === "tool-churn-search")!, {
      userClarifications: 0,
      toolCalls: 8,
      sameFileReads: 1,
      corrections: 0,
      skillsUsed: [],
      askedUserFor: [],
    })
    expect(scenario.pass).toBe(true)

    const loop = await EvolutionSoftLoop.softSkillLoop({
      projectID,
      worktree,
      skillName: "repeat-grep",
      skillMarkdown:
        "---\nname: repeat-grep\ndescription: Prefer grep over repeated file reads\n---\n\n# Repeat Grep\n",
      evidenceSummary: "same file re-read pattern across sessions",
      before: metrics({}),
      after: metrics({
        toolCalls: 80,
        correctionHints: 2,
        humanAttentionCost: { score: 10, level: "low", drivers: [] },
        assistantTurns: 20,
      }),
      beforeWindow: { windowStartMs: 0, windowEndMs: 1000, sampleSize: 10 },
      afterWindow: { windowStartMs: 1000, windowEndMs: 2000, sampleSize: 10 },
      scenarios: [scenario],
    })

    expect(loop.adopted).toBe(true)
    expect(loop.gate.verdict).toBe("pass")
    expect(loop.evolution.status).toBe("accepted")
    const active = path.join(worktree, ".oimo", "skills", "repeat-grep", "SKILL.md")
    expect(await Bun.file(active).exists()).toBe(true)

    const mem = await EvolutionSoftLoop.writeProvenanceMemory({
      memoryRoot: path.join(worktree, ".oimo", "memory"),
      entry: {
        statement: "Prefer grep over rereading the same file",
        scope: "project",
        evidenceIDs: [loop.evidence.id],
        confidence: 0.85,
      },
    })
    expect(mem.ok).toBe(true)

    expect(loop.snapshotID).toBeTruthy()
    await EvolutionSoftLoop.rollbackSoftSkill({
      projectID,
      worktree,
      snapshotID: loop.snapshotID!,
      evolutionID: loop.evolution.id,
    })
    expect(await Bun.file(active).exists()).toBe(false)
  })

  test("gate fail does not activate skill", async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "oimo-soft-fail-"))
    await fs.mkdir(path.join(worktree, ".oimo"), { recursive: true })
    const loop = await EvolutionSoftLoop.softSkillLoop({
      projectID: `soft-fail-${Date.now()}`,
      worktree,
      skillName: "bad-improve",
      skillMarkdown: "---\nname: bad-improve\ndescription: noop\n---\n\n# x\n",
      evidenceSummary: "worsened metrics",
      before: metrics({
        toolCalls: 50,
        correctionHints: 1,
        humanAttentionCost: { score: 5, level: "low", drivers: [] },
      }),
      after: metrics({}),
      beforeWindow: { windowStartMs: 0, windowEndMs: 100, sampleSize: 5 },
      afterWindow: { windowStartMs: 100, windowEndMs: 200, sampleSize: 5 },
    })
    expect(loop.adopted).toBe(false)
    expect(loop.gate.verdict).toBe("fail")
    expect(await Bun.file(path.join(worktree, ".oimo", "skills", "bad-improve", "SKILL.md")).exists()).toBe(
      false,
    )
  })
})

describe("hard brief E2E", () => {
  test("validated brief under evolve home; product source untouched", async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "oimo-hard-e2e-"))
    const product = path.join(worktree, "packages", "opencode", "src", "index.ts")
    await fs.mkdir(path.dirname(product), { recursive: true })
    await fs.writeFile(product, "export const sentinel = 1\n", "utf8")

    const result = await EvolutionHardLoop.hardBriefLoop({
      projectID: `hard-e2e-${Date.now()}`,
      worktree,
      evidenceSummary: "clarification churn across projects",
      productSourceProbe: product,
    })

    expect(result.ok).toBe(true)
    expect(result.productSourceUntouched).toBe(true)
    expect(result.briefPath).toBeTruthy()
    expect(await Bun.file(result.briefPath!).exists()).toBe(true)
    expect(result.briefPath!).toContain(path.join(".oimo", "evolve"))
    expect(await fs.readFile(product, "utf8")).toBe("export const sentinel = 1\n")
    expect(result.evolution?.status).toBe("accepted")
    expect(result.evolution?.kind).toBe("hard-brief")
  })
})

describe("candidate router + knowledge scope", () => {
  test("validates decisions and separates repo knowledge", () => {
    const ok = EvolutionCandidateRouter.validateCandidateDecision({
      classification: "hard_evolution_brief",
      confidence: 0.9,
      reason: "product-common clarification churn",
      targetScope: "product",
    })
    expect(ok.ok).toBe(true)

    const bad = EvolutionCandidateRouter.validateCandidateDecision({
      classification: "hard_evolution_brief",
      confidence: 0.9,
      reason: "wrong scope",
      targetScope: "repository",
    })
    expect(bad.ok).toBe(false)

    const target = EvolutionKnowledgeScope.resolveKnowledgeTarget({
      classification: "durable_fact",
      repositoryID: "repo-a",
      projectID: "p",
      worktree: "/wt",
      evolveHome: "/home/.oimo/evolve/p",
    })
    expect(target.ok).toBe(true)
    if (target.ok) expect(target.target.kind).toBe("repo")

    const refuse = EvolutionKnowledgeScope.assertKnowledgeApplies({
      entryKind: "repo",
      entryRepositoryID: "repo-a",
      targetRepositoryID: "repo-b",
    })
    expect(refuse.ok).toBe(false)
  })
})

describe("scenario observation from traces", () => {
  test("counts tools, rereads, corrections from structured parts", () => {
    const obs = EvolutionObserveTrace.observeFromTrace([
      {
        role: "user",
        parts: [{ type: "text", text: "wrong again, that is not what I said" }],
      },
      {
        role: "assistant",
        parts: [
          {
            type: "tool",
            tool: "read",
            state: { input: { file_path: "/a/src.ts" } },
          },
          {
            type: "tool",
            tool: "read",
            state: { input: { file_path: "/a/src.ts" } },
          },
          {
            type: "tool",
            tool: "read",
            state: { input: { file_path: "/a/src.ts" } },
          },
          {
            type: "tool",
            tool: "read",
            state: { input: { file_path: "/a/src.ts" } },
          },
          {
            type: "tool",
            tool: "skill",
            state: { input: { name: "verify" } },
          },
        ],
      },
    ])
    expect(obs.corrections).toBeGreaterThanOrEqual(1)
    expect(obs.toolCalls).toBe(5)
    expect(obs.sameFileReads).toBeGreaterThan(3)
    expect(obs.skillsUsed).toContain("verify")

    const fixture = BUILTIN_SCENARIOS.find((s) => s.id === "same-file-reread")!
    const score = EvolveScenario.scoreScenario(fixture, obs)
    expect(score.pass).toBe(false)
  })
})

describe("symlink adversarial evolve write", () => {
  test("denies escape via symlink into product source", async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "oimo-sym-"))
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "oimo-sym-out-"))
    const product = path.join(outside, "secret-src.ts")
    await fs.writeFile(product, "secret\n", "utf8")
    const oimo = path.join(worktree, ".oimo")
    await fs.mkdir(oimo, { recursive: true })
    const link = path.join(oimo, "escape")
    await fs.symlink(outside, link)

    const decision = EvolutionWritePolicy.decideEvolveWrite({
      projectID: "sym-proj",
      worktree,
      absolutePath: path.join(link, "secret-src.ts"),
      track: "evolve",
    })
    expect(decision.ok).toBe(false)
  })

  test("denies cross-project evolve via sibling symlink", async () => {
    const projectID = `sym-cross-${Date.now()}`
    const other = EvolveStore.evolveRoot("other-proj-sym")
    await fs.mkdir(path.join(other, "briefs"), { recursive: true })
    const mine = EvolveStore.evolveRoot(projectID)
    await fs.mkdir(mine, { recursive: true })
    const link = path.join(mine, "sneak")
    await fs.symlink(other, link).catch(() => undefined)

    const decision = EvolutionWritePolicy.decideEvolveWrite({
      projectID,
      worktree: "/tmp/wt",
      absolutePath: path.join(link, "briefs", "x.md"),
      track: "hard-brief",
    })
    expect(decision.ok).toBe(false)
  })
})

describe("customer vs evolve ChangeSet", () => {
  test("inferKindFromPath separates evolve from customer", () => {
    expect(ChangeSet.inferKindFromPath("/home/u/.oimo/evolve/p/briefs/a.md")).toBe("evolve")
    expect(ChangeSet.inferKindFromPath("/wt/packages/opencode/src/x.ts")).toBe("customer")
    expect(ChangeSet.storageKey("ses_1", "evolve")).not.toBe(ChangeSet.storageKey("ses_1", "customer"))
  })
})

describe("handoff + retention", () => {
  test("lists briefs as pending handoffs and purges by retention", async () => {
    const projectID = `handoff-${Date.now()}`
    const root = EvolveStore.evolveRoot(projectID)
    const briefs = path.join(root, "briefs")
    await fs.mkdir(briefs, { recursive: true })
    const briefPath = path.join(briefs, "2026-09-18-demo.md")
    await fs.writeFile(briefPath, "# Demo brief\n\nEvidence ID: evd_x\n", "utf8")

    const { EvolutionHandoff, EvolutionRetention } = await import("../../src/evolve")
    const items = await EvolutionHandoff.listPendingHandoffs(projectID)
    expect(items.some((i) => i.briefFile === "2026-09-18-demo.md")).toBe(true)
    expect(EvolutionHandoff.formatPendingHandoffs(items)).toContain("Pending hard-evolution")

    const old = path.join(briefs, "old.md")
    await fs.writeFile(old, "old\n", "utf8")
    const past = Date.now() - 200 * 86400000
    await fs.utimes(old, past / 1000, past / 1000)
    const purged = await EvolutionRetention.purgeExpiredArtifacts({
      projectID,
      retentionDays: 90,
    })
    expect(purged.removed.some((r) => r.includes("old.md"))).toBe(true)
    expect(await Bun.file(briefPath).exists()).toBe(true)
    expect(EvolutionRetention.isEvolutionPaused({ evolution: { paused: true } })).toBe(true)
    expect(EvolutionRetention.isEvolutionPaused({ memory: { disable_write: true } })).toBe(true)
  })
})

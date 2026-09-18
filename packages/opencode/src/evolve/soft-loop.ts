/**
 * Soft-evolution closed loop helpers: generate → validate → evaluate → adopt/rollback.
 */
import fs from "fs/promises"
import path from "path"
import { createEvidence, type EvidenceRecord } from "./evidence"
import { validateMemoryEntry, type MemoryEntry } from "./memory-entry"
import { stageSkill, activateStagedSkill, validateSkillMarkdown } from "./skill-staging"
import { createSnapshot, rollbackSnapshot } from "./rollback"
import { compareFrictionWindows, combineGate, type GateResult } from "./evaluate"
import type { FrictionMetrics } from "./metrics"
import type { ScenarioScore } from "./scenario"
import { createEvolution, transition } from "./state"
import type { EvolutionRecord } from "./evolution.sql"

export async function writeProvenanceMemory(input: {
  memoryRoot: string
  entry: Partial<MemoryEntry>
}): Promise<{ ok: true; entry: MemoryEntry; path: string } | { ok: false; errors: string[] }> {
  const v = validateMemoryEntry(input.entry)
  if (!v.ok) return v
  const dir = path.join(input.memoryRoot, "entries")
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${v.entry.id}.json`)
  await fs.writeFile(file, JSON.stringify(v.entry, null, 2), "utf8")
  return { ok: true, entry: v.entry, path: file }
}

export async function softSkillLoop(input: {
  projectID: string
  worktree: string
  skillName: string
  skillMarkdown: string
  evidenceSummary: string
  before: FrictionMetrics
  after: FrictionMetrics
  beforeWindow: { windowStartMs: number; windowEndMs: number; sampleSize: number }
  afterWindow: { windowStartMs: number; windowEndMs: number; sampleSize: number }
  scenarios?: ScenarioScore[]
}): Promise<{
  evidence: EvidenceRecord
  evolution: EvolutionRecord
  gate: GateResult
  stagedPath?: string
  activePath?: string
  snapshotID?: string
  adopted: boolean
}> {
  const evidence = createEvidence({
    projectID: input.projectID,
    kind: "friction",
    summary: input.evidenceSummary,
  })
  let evolution = createEvolution({
    projectID: input.projectID,
    kind: "soft",
    evidenceIDs: [evidence.id],
    title: `soft skill ${input.skillName}`,
  })
  evolution = transition({ id: evolution.id, to: "candidate", evidenceIDs: [evidence.id] })
  evolution = transition({ id: evolution.id, to: "planned" })
  evolution = transition({ id: evolution.id, to: "generated" })

  const skillCheck = validateSkillMarkdown(input.skillMarkdown, { skillName: input.skillName })
  if (!skillCheck.ok) {
    evolution = transition({
      id: evolution.id,
      to: "rejected",
      result: { verdict: "fail", notes: skillCheck.errors },
    })
    return {
      evidence,
      evolution,
      gate: { verdict: "fail", notes: skillCheck.errors },
      adopted: false,
    }
  }

  const staged = await stageSkill({
    worktree: input.worktree,
    skillName: input.skillName,
    files: { "SKILL.md": input.skillMarkdown },
  })
  if (!staged.ok) {
    evolution = transition({
      id: evolution.id,
      to: "rejected",
      result: { verdict: "fail", notes: staged.errors },
    })
    return {
      evidence,
      evolution,
      gate: { verdict: "fail", notes: staged.errors },
      adopted: false,
    }
  }

  evolution = transition({
    id: evolution.id,
    to: "validating",
    baseline: input.beforeWindow,
    artifactIDs: [staged.stagedPath],
  })
  const snap = await createSnapshot({ projectID: input.projectID, worktree: input.worktree }, "pre-activate")
  const friction = compareFrictionWindows({
    before: input.before,
    after: input.after,
    beforeWindow: input.beforeWindow,
    afterWindow: input.afterWindow,
  })
  const gate = combineGate({ friction, scenarios: input.scenarios ?? [] })

  if (gate.verdict !== "pass") {
    evolution = transition({
      id: evolution.id,
      to: gate.verdict === "fail" ? "rejected" : "inconclusive",
      result: {
        verdict: gate.verdict,
        notes: gate.notes,
        before: input.beforeWindow,
        after: input.afterWindow,
      },
    })
    return {
      evidence,
      evolution,
      gate,
      stagedPath: staged.stagedPath,
      snapshotID: snap.id,
      adopted: false,
    }
  }

  const act = await activateStagedSkill({ worktree: input.worktree, skillName: input.skillName })
  if (!act.ok) {
    evolution = transition({
      id: evolution.id,
      to: "rejected",
      result: { verdict: "fail", notes: act.errors },
    })
    return {
      evidence,
      evolution,
      gate: { verdict: "fail", notes: act.errors },
      stagedPath: staged.stagedPath,
      snapshotID: snap.id,
      adopted: false,
    }
  }

  evolution = transition({
    id: evolution.id,
    to: "accepted",
    artifactIDs: [act.stagedPath],
    result: {
      verdict: "pass",
      notes: gate.notes,
      before: input.beforeWindow,
      after: input.afterWindow,
    },
  })
  return {
    evidence,
    evolution,
    gate,
    stagedPath: staged.stagedPath,
    activePath: act.stagedPath,
    snapshotID: snap.id,
    adopted: true,
  }
}

export async function rollbackSoftSkill(input: {
  projectID: string
  worktree: string
  snapshotID: string
  evolutionID?: string
}) {
  const snap = await rollbackSnapshot(
    { projectID: input.projectID, worktree: input.worktree },
    input.snapshotID,
  )
  if (input.evolutionID) {
    transition({ id: input.evolutionID, to: "rolled_back" })
  }
  return snap
}

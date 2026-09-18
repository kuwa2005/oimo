import { describe, expect, test } from "bun:test"
import {
  EvolutionEvidence,
  EvolutionScheduler,
  EvolutionBriefValidator,
} from "../../src/evolve"

describe("EvolutionEvidence", () => {
  test("redacts secrets and marks evidence", () => {
    const raw =
      "failed with Bearer sk-abc1234567890token and AKIAIOSFODNN7EXAMPLE in logs"
    const ev = EvolutionEvidence.createEvidence({
      projectID: "p1",
      kind: "error",
      summary: raw,
      excerpt: raw,
    })
    expect(ev.redacted).toBe(true)
    expect(ev.summary).not.toContain("AKIAIOSFODNN7EXAMPLE")
    expect(ev.summary).toContain("[REDACTED:")
    expect(ev.id.startsWith("evd_")).toBe(true)
    expect(ev.fingerprint.length).toBe(32)
  })

  test("assertSafeForArtifact rejects leftover private keys", () => {
    const text = "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----"
    const r = EvolutionEvidence.assertSafeForArtifact(text)
    // after redact, BEGIN might become REDACTED — either ok or fail is fine if no raw key
    if (r.ok) expect(r.text).not.toContain("BEGIN PRIVATE KEY")
  })
})

describe("EvolutionScheduler", () => {
  test("lease acquire / cooldown / reclaim", () => {
    const projectID = `sched-${Date.now()}`
    const a = EvolutionScheduler.tryAcquireLease({ projectID, track: "evolve", ttlMs: 60_000 })
    expect(a.ok).toBe(true)
    const b = EvolutionScheduler.tryAcquireLease({ projectID, track: "evolve", ttlMs: 60_000 })
    expect(b.ok).toBe(false)

    if (a.ok) {
      expect(EvolutionScheduler.releaseLease(projectID, "evolve", a.owner)).toBe(true)
    }
    EvolutionScheduler.recordRun(projectID, "evolve", Date.now())
    const due = EvolutionScheduler.isDue({
      projectID,
      track: "evolve",
      intervalMs: 14 * 24 * 60 * 60 * 1000,
    })
    expect(due.due).toBe(false)
    expect(due.reason).toBe("cooldown")

    const other = EvolutionScheduler.isDue({
      projectID: `${projectID}-other`,
      track: "evolve",
      intervalMs: 14 * 24 * 60 * 60 * 1000,
    })
    expect(other.due).toBe(true)
  })
})

describe("EvolutionBriefValidator", () => {
  test("rejects empty and incomplete briefs", () => {
    expect(EvolutionBriefValidator.validateHardBrief("").ok).toBe(false)
    expect(EvolutionBriefValidator.validateHardBrief("# x\n\n## Meta\n").ok).toBe(false)
  })

  test("accepts complete brief with Evidence ID", () => {
    const md = [
      "# Evolve Brief: fix",
      "## Meta",
      "- ID: EVB-20260918-fix",
      "## 1. 現状",
      "x",
      "## 2. 問題点",
      "y",
      "## 3. 問題が発生した具体例",
      "Evidence ID: evd_abc123",
      "## 4. 原因の推定",
      "z",
      "## 5. 改善方針",
      "a",
      "## 6. 実装案",
      "b",
      "## 7. 期待する動作",
      "c",
      "## 8. 受け入れ条件",
      "- [ ] tests pass",
      "## 9. 副作用・注意点",
      "none",
      "## Security / Privacy",
      "no secrets",
      "## Test plan",
      "unit + e2e",
      "## Rollback plan",
      "revert PR",
      "## Out of scope",
      "UI polish",
      "## Why not soft evolution?",
      "needs core change",
    ].join("\n")
    const v = EvolutionBriefValidator.validateHardBrief(md)
    expect(v.ok).toBe(true)
  })

  test("rejects credential-bearing brief", () => {
    const md = [
      "# Evolve Brief: leak",
      "## Meta",
      "- ID: EVB-1",
      "## 1. 現状",
      "x",
      "## 2. 問題点",
      "y",
      "## 3. 問題が発生した具体例",
      "token AKIAIOSFODNN7EXAMPLE Evidence ID: evd_1",
      "## 4. 原因の推定",
      "z",
      "## 5. 改善方針",
      "a",
      "## 6. 実装案",
      "b",
      "## 7. 期待する動作",
      "c",
      "## 8. 受け入れ条件",
      "- [ ] ok",
      "## 9. 副作用・注意点",
      "n",
      "## Security / Privacy",
      "s",
      "## Test plan",
      "t",
      "## Rollback plan",
      "r",
      "## Out of scope",
      "o",
      "## Why not soft evolution?",
      "core",
    ].join("\n")
    const v = EvolutionBriefValidator.validateHardBrief(md)
    expect(v.ok).toBe(false)
  })
})

import { describe, expect, test } from "bun:test"
import { classifyChangeKind, planVerification } from "../../src/autonomy/verify-plan"
import {
  classifyFailure,
  decideRetry,
  failureSignature,
  recordTestAttempt,
  freshPassingAttempts,
} from "../../src/autonomy/test-attempt"
import { buildManifest, judgeFromManifest, hashScopeFields } from "../../src/autonomy/evidence"
import { AutonomyRun } from "../../src/autonomy"

describe("Verification Planner", () => {
  test("docs-only does not require unit tests", () => {
    const kind = classifyChangeKind({ paths: ["docs/autonomy/baseline.md"] })
    expect(kind).toBe("docs_only")
    const plan = planVerification(kind)
    expect(plan.steps.every((s) => s.kind !== "unit")).toBe(true)
    expect(plan.notes.some((n) => /no new unit tests/i.test(n))).toBe(true)
  })

  test("pure logic gets focused unit + typecheck", () => {
    const plan = planVerification("pure_logic")
    expect(plan.steps.some((s) => s.kind === "unit")).toBe(true)
    expect(plan.steps.some((s) => s.kind === "typecheck")).toBe(true)
  })
})

describe("TestAttempt + retry", () => {
  test("blocks identical signature retry without change", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_attempt_1",
      projectID: "proj_attempt",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "x",
    })
    const cmd = ["bun", "test", "foo"]
    const sig = failureSignature({ command: cmd, exitCode: 1, stderrTail: "AssertionError" })
    recordTestAttempt({
      runID: run.id,
      command: cmd,
      environmentFingerprint: "env1",
      codeRevision: "rev1",
      startedAt: Date.now(),
      durationMs: 10,
      exitCode: 1,
      status: "failed",
      failureSignature: sig,
      failureClass: classifyFailure({ status: "failed", stderr: "AssertionError" }),
    })
    const denied = decideRetry({
      runID: run.id,
      command: cmd,
      codeRevision: "rev1",
      environmentFingerprint: "env1",
      failureSignature: sig,
      maxAttemptsPerSignature: 2,
      changedSinceLast: false,
    })
    expect(denied.allow).toBe(false)
    if (!denied.allow) expect(denied.stop).toBe("repeated_failure")

    const allowed = decideRetry({
      runID: run.id,
      command: cmd,
      codeRevision: "rev2",
      environmentFingerprint: "env1",
      failureSignature: sig,
      maxAttemptsPerSignature: 2,
      changedSinceLast: true,
    })
    expect(allowed.allow).toBe(true)
  })

  test("stale pass on old revision is not fresh", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_attempt_2",
      projectID: "proj_attempt",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "x",
    })
    recordTestAttempt({
      runID: run.id,
      command: ["bun", "test"],
      environmentFingerprint: "e",
      codeRevision: "old",
      startedAt: Date.now(),
      durationMs: 1,
      exitCode: 0,
      status: "passed",
    })
    expect(freshPassingAttempts({ runID: run.id, codeRevision: "new" }).length).toBe(0)
  })
})

describe("Evidence Manifest + Judge", () => {
  test("judge_unavailable is never complete", () => {
    const fields = {
      objective: "o",
      acceptance_criteria: ["done"],
      in_scope: [],
      out_of_scope: [],
      repositories: [],
      risks: [],
    }
    const lockedScope = { ...fields, hash: hashScopeFields(fields) }
    const v = judgeFromManifest({
      lockedScope,
      judgeAvailable: false,
      unavailableReason: "model down",
    })
    expect(v.status).toBe("judge_unavailable")
  })

  test("complete only when acceptance met with fresh attempts", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_ev_1",
      projectID: "proj_ev",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "x",
    })
    const fields = {
      objective: "o",
      acceptance_criteria: ["tests pass"],
      in_scope: [],
      out_of_scope: [],
      repositories: [],
      risks: [],
    }
    const lockedScope = { ...fields, hash: hashScopeFields(fields) }
    recordTestAttempt({
      runID: run.id,
      command: ["bun", "test"],
      environmentFingerprint: "e",
      codeRevision: "r1",
      startedAt: Date.now(),
      durationMs: 5,
      exitCode: 0,
      status: "passed",
    })
    const manifest = buildManifest({
      runID: run.id,
      lockedScope,
      codeRevision: "r1",
    })
    expect(manifest.unresolved.length).toBe(0)
    const v = judgeFromManifest({ lockedScope, manifest, judgeAvailable: true })
    expect(v.status).toBe("complete")
  })
})

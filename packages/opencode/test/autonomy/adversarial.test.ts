import { describe, expect, test } from "bun:test"
import { AutonomyGate, AutonomyRun } from "../../src/autonomy"
import { applySessionMode } from "../../src/autonomy/session-mode"
import { decideRetry, failureSignature, recordTestAttempt } from "../../src/autonomy/test-attempt"
import { judgeFromManifest, hashScopeFields } from "../../src/autonomy/evidence"

describe("adversarial autonomy", () => {
  test("natural-language yes on wrong question index cannot lock", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_adv_lock",
      projectID: "proj_adv",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "ship",
    })
    const proposal = "Requirements: do the thing"
    const gate = AutonomyGate.createGate({
      runID: run.id,
      kind: "requirements_lock",
      proposalText: proposal,
      questionRequestID: "q",
      questionIndex: 0,
    })
    // Attacker answers a different question with Approved
    const bad = AutonomyGate.respondToGate({
      gateID: gate.id,
      answers: [["maybe"], ["Approved — looks good, proceed"]],
      proposalTextNow: proposal,
    })
    expect(bad.status).toBe("pending")
  })

  test("mutated proposal after gate expires approval", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_adv_hash",
      projectID: "proj_adv",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "ship",
    })
    const gate = AutonomyGate.createGate({
      runID: run.id,
      kind: "requirements_lock",
      proposalText: "v1 scope",
      questionRequestID: "q",
      questionIndex: 0,
    })
    const expired = AutonomyGate.respondToGate({
      gateID: gate.id,
      answers: [["approved"]],
      proposalTextNow: "v2 sneaky expanded scope",
    })
    expect(expired.status).toBe("expired")
  })

  test("/auto session scope does not mark persistGlobal", () => {
    const a = applySessionMode({
      mode: "normal",
      scope: "session",
      sessionID: "ses_adv_iso_a",
      projectID: "proj_a",
    })
    const b = applySessionMode({
      mode: "fde",
      scope: "session",
      sessionID: "ses_adv_iso_b",
      projectID: "proj_b",
    })
    expect(a.persistGlobal).toBe(false)
    expect(b.persistGlobal).toBe(false)
    expect(a.run?.projectID).toBe("proj_a")
    expect(b.run?.projectID).toBe("proj_b")
    expect(a.run?.id).not.toBe(b.run?.id)
  })

  test("infinite identical failure retry is refused", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_adv_retry",
      projectID: "proj_adv",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "x",
    })
    const cmd = ["bun", "test"]
    const sig = failureSignature({ command: cmd, exitCode: 1, stderrTail: "fail" })
    recordTestAttempt({
      runID: run.id,
      command: cmd,
      environmentFingerprint: "e",
      codeRevision: "r",
      startedAt: Date.now(),
      durationMs: 1,
      exitCode: 1,
      status: "failed",
      failureSignature: sig,
    })
    for (let i = 0; i < 5; i++) {
      const d = decideRetry({
        runID: run.id,
        command: cmd,
        codeRevision: "r",
        environmentFingerprint: "e",
        failureSignature: sig,
        maxAttemptsPerSignature: 2,
        changedSinceLast: false,
      })
      expect(d.allow).toBe(false)
    }
  })

  test("assistant prose alone cannot complete via judgeFromManifest", () => {
    const fields = {
      objective: "done",
      acceptance_criteria: ["shipped"],
      in_scope: [],
      out_of_scope: [],
      repositories: [],
      risks: [],
    }
    const lockedScope = { ...fields, hash: hashScopeFields(fields) }
    const v = judgeFromManifest({
      lockedScope,
      judgeAvailable: true,
      // no manifest
    })
    expect(v.status).not.toBe("complete")
  })
})

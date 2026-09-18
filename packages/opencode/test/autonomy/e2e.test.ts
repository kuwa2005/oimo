import { describe, expect, test } from "bun:test"
import { AutonomyGate, AutonomyRun } from "../../src/autonomy"
import { applySessionMode } from "../../src/autonomy/session-mode"
import { planVerification, classifyChangeKind } from "../../src/autonomy/verify-plan"
import {
  recordTestAttempt,
  failureSignature,
  classifyFailure,
} from "../../src/autonomy/test-attempt"
import { buildManifest, judgeFromManifest, hashScopeFields } from "../../src/autonomy/evidence"

describe("autonomy e2e path (unit, no spawn)", () => {
  test("session /auto → lock → verify plan → TestAttempt → manifest → judge complete", () => {
    const applied = applySessionMode({
      mode: "normal",
      scope: "session",
      sessionID: "ses_e2e_1",
      projectID: "proj_e2e",
      userRequest: "fix the flaky helper",
    })
    expect(applied.persistGlobal).toBe(false)
    const run = applied.run!
    expect(run.profile).toBe("se")

    const kind = classifyChangeKind({ paths: ["packages/opencode/src/util/foo.ts"], touchesTests: true })
    const plan = planVerification(kind)
    expect(plan.steps.some((s) => s.required)).toBe(true)

    const fields = {
      objective: "fix flaky helper",
      acceptance_criteria: ["focused test passes on current revision"],
      in_scope: ["packages/opencode/src/util/foo.ts"],
      out_of_scope: [],
      repositories: ["primary"],
      risks: [],
      verification_plan: plan as unknown as Record<string, unknown>,
    }
    const lockedScope = { ...fields, hash: hashScopeFields(fields) }

    const proposal = JSON.stringify(lockedScope)
    const gate = AutonomyGate.createGate({
      runID: run.id,
      kind: "requirements_lock",
      proposalText: proposal,
      questionRequestID: "qr_e2e",
      questionIndex: 0,
    })
    const approved = AutonomyGate.respondToGate({
      gateID: gate.id,
      answers: [["approved"]],
      proposalTextNow: proposal,
      lockedScope,
    })
    expect(approved.status).toBe("approved")

    let cur = AutonomyRun.getRun(run.id)!
    expect(cur.phase).toBe("execute")
    expect(cur.lockedScope?.hash).toBe(lockedScope.hash)

    cur = AutonomyRun.transition({
      id: cur.id,
      expectedRevision: cur.revision,
      event: { type: "implementation_done" },
    })
    expect(cur.phase).toBe("verify")

    const cmd = plan.steps.find((s) => s.command)?.command ?? ["bun", "test", "test/util/foo.test.ts"]
    recordTestAttempt({
      runID: cur.id,
      command: cmd,
      environmentFingerprint: "ci-linux",
      codeRevision: "rev_e2e",
      startedAt: Date.now(),
      durationMs: 42,
      exitCode: 0,
      status: "passed",
      failureSignature: failureSignature({ command: cmd, exitCode: 0 }),
      failureClass: classifyFailure({ status: "passed" }),
    })

    cur = AutonomyRun.transition({
      id: cur.id,
      expectedRevision: cur.revision,
      event: { type: "verify_passed" },
    })
    expect(cur.phase).toBe("judge")

    const manifest = buildManifest({
      runID: cur.id,
      lockedScope,
      codeRevision: "rev_e2e",
      changedFiles: ["packages/opencode/src/util/foo.ts"],
    })
    expect(manifest.unresolved).toEqual([])

    const verdict = judgeFromManifest({
      lockedScope,
      manifest,
      judgeAvailable: true,
    })
    expect(verdict.status).toBe("complete")

    cur = AutonomyRun.transition({
      id: cur.id,
      expectedRevision: cur.revision,
      event: { type: "judge_complete" },
    })
    expect(cur.phase).toBe("completed")
    expect(cur.stopReason).toBe("completed")
  })
})

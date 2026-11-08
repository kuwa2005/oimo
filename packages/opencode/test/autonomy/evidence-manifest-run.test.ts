import { describe, expect, test } from "bun:test"
import { AutonomyGate, AutonomyRun } from "../../src/autonomy"
import { applySessionMode } from "../../src/autonomy/session-mode"
import { getLatestManifest } from "../../src/autonomy/evidence"
import { hashScopeFields } from "../../src/autonomy/evidence"
import { recordTestAttempt, classifyFailure, failureSignature } from "../../src/autonomy/test-attempt"
import { AutonomyTestAttemptTable } from "../../src/autonomy/test-attempt"
import { Database, eq } from "../../src/storage"

describe("autonomy evidence manifest on complete", () => {
  test("judge_complete persists evidence manifest", () => {
    const applied = applySessionMode({
      mode: "normal",
      scope: "session",
      sessionID: `ses_manifest_${Date.now()}`,
      projectID: "proj_manifest",
      userRequest: "ship it",
    })
    const run = applied.run!
    const fields = {
      objective: "test",
      acceptance_criteria: ["tests pass"],
      in_scope: ["src"],
      out_of_scope: [],
      repositories: ["repo1"],
      risks: [],
    }
    const lockedScope = { ...fields, hash: hashScopeFields(fields) }
    const proposal = JSON.stringify(lockedScope)
    const gate = AutonomyGate.createGate({
      runID: run.id,
      kind: "requirements_lock",
      proposalText: proposal,
      questionRequestID: "qr_manifest",
      questionIndex: 0,
    })
    AutonomyGate.respondToGate({
      gateID: gate.id,
      answers: [["approved"]],
      proposalTextNow: proposal,
      lockedScope,
    })

    let cur = AutonomyRun.getRun(run.id)!
    expect(cur.phase).toBe("execute")

    cur = AutonomyRun.transition({
      id: cur.id,
      expectedRevision: cur.revision,
      event: { type: "implementation_done" },
    })
    const cmd = ["bun", "test", "x"]
    recordTestAttempt({
      runID: cur.id,
      command: cmd,
      environmentFingerprint: "env",
      codeRevision: String(cur.revision),
      startedAt: Date.now(),
      durationMs: 1,
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
    cur = AutonomyRun.transition({
      id: cur.id,
      expectedRevision: cur.revision,
      event: { type: "judge_complete" },
    })
    expect(cur.phase).toBe("completed")
    expect(cur.evidenceManifestID).toBeDefined()

    const manifest = getLatestManifest(run.id)
    expect(manifest).toBeDefined()
    expect(manifest!.runID).toBe(run.id)
  })

  test("failed attempt records non-unknown failure class", () => {
    const applied = applySessionMode({
      mode: "normal",
      scope: "session",
      sessionID: `ses_manifest_fail_${Date.now()}`,
      projectID: "proj_manifest",
      userRequest: "x",
    })
    const run = applied.run!
    recordTestAttempt({
      runID: run.id,
      command: ["bun", "test", "fail"],
      environmentFingerprint: "env",
      codeRevision: "1",
      startedAt: Date.now(),
      durationMs: 1,
      exitCode: 1,
      status: "failed",
      failureSignature: failureSignature({
        command: ["bun", "test", "fail"],
        exitCode: 1,
        stderrTail: "AssertionError: bad",
      }),
      failureClass: classifyFailure({ status: "failed", stderr: "AssertionError: bad" }),
    })
    const row = Database.Client()
      .select()
      .from(AutonomyTestAttemptTable)
      .where(eq(AutonomyTestAttemptTable.run_id, run.id))
      .get()
    expect(row?.failure_class).toBe("test_failure")
  })
})

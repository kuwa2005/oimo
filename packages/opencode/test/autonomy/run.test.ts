import { describe, expect, test } from "bun:test"
import { AutonomyRun } from "../../src/autonomy"

describe("AutonomyRun state machine", () => {
  test("create → lock → execute → verify → judge → completed", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_autonomy_1",
      projectID: "proj_autonomy_1",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "fix the flaky test",
    })
    expect(run.phase).toBe("discover")
    expect(run.revision).toBe(1)

    const pending = AutonomyRun.transition({
      id: run.id,
      expectedRevision: 1,
      event: { type: "lock_proposed" },
    })
    expect(pending.phase).toBe("lock_pending")
    expect(pending.stopReason).toBe("waiting_for_lock")

    const locked = AutonomyRun.transition({
      id: run.id,
      expectedRevision: 2,
      event: {
        type: "lock_approved",
        lockedScope: {
          objective: "fix flaky test",
          acceptance_criteria: ["test passes twice"],
          in_scope: ["packages/opencode/test"],
          out_of_scope: [],
          repositories: ["primary"],
          risks: [],
          hash: "abc",
        },
      },
    })
    expect(locked.phase).toBe("execute")
    expect(locked.lockedScope?.hash).toBe("abc")

    const verifying = AutonomyRun.transition({
      id: run.id,
      expectedRevision: 3,
      event: { type: "implementation_done" },
    })
    expect(verifying.phase).toBe("verify")

    const judging = AutonomyRun.transition({
      id: run.id,
      expectedRevision: 4,
      event: { type: "verify_passed" },
    })
    expect(judging.phase).toBe("judge")

    const done = AutonomyRun.transition({
      id: run.id,
      expectedRevision: 5,
      event: { type: "judge_complete" },
    })
    expect(done.phase).toBe("completed")
    expect(done.stopReason).toBe("completed")

    const again = AutonomyRun.getRun(run.id)
    expect(again?.phase).toBe("completed")
    expect(AutonomyRun.listAudit(run.id).length).toBeGreaterThanOrEqual(6)
  })

  test("revision CAS rejects stale writers", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_cas",
      projectID: "proj_cas",
      profile: "fde",
      learningLenses: ["fde"],
      userRequest: "field issue",
    })
    AutonomyRun.transition({ id: run.id, expectedRevision: 1, event: { type: "ask_user" } })
    expect(() =>
      AutonomyRun.transition({ id: run.id, expectedRevision: 1, event: { type: "cancel" } }),
    ).toThrow(/revision/)
  })

  test("lock_changes_needed returns to discover", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_chg",
      projectID: "proj_chg",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "x",
    })
    AutonomyRun.transition({ id: run.id, expectedRevision: 1, event: { type: "lock_proposed" } })
    const back = AutonomyRun.transition({
      id: run.id,
      expectedRevision: 2,
      event: { type: "lock_changes_needed" },
    })
    expect(back.phase).toBe("discover")
  })

  test("getLatestRunForSession restores after create", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_latest",
      projectID: "proj_latest",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "restore me",
    })
    const latest = AutonomyRun.getLatestRunForSession("ses_latest")
    expect(latest?.id).toBe(run.id)
    expect(latest?.userRequest).toBe("restore me")
  })
})

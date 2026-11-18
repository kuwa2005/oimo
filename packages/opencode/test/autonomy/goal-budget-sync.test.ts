import { describe, expect, test } from "bun:test"
import { AutonomyRun } from "../../src/autonomy"

function newRun(maxTurns: number) {
  const sessionID = `ses_goal_budget_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const run = AutonomyRun.createRun({
    sessionID,
    projectID: "proj_goal_budget",
    profile: "se",
    learningLenses: [],
    userRequest: "x",
    budgets: { maxTurns },
  })
  return { sessionID, run }
}

describe("goal → autonomy run budget sync", () => {
  test("goal re-entry increments modelTurns and blocks once maxTurns is exceeded", () => {
    const { sessionID, run } = newRun(2)
    expect(AutonomyRun.recordGoalReentry(sessionID)?.counters.modelTurns).toBe(1)
    expect(AutonomyRun.recordGoalReentry(sessionID)?.phase).toBe("discover")
    const after = AutonomyRun.recordGoalReentry(sessionID)
    expect(after?.counters.modelTurns).toBe(3)
    expect(after?.phase).toBe("blocked")
    expect(after?.stopReason).toBe("budget_model_turns")
    expect(AutonomyRun.getRun(run.id)?.phase).toBe("blocked")
  })

  test("goal budget stop marks the run blocked with the mapped reason", () => {
    const { sessionID } = newRun(50)
    const after = AutonomyRun.recordGoalStop(sessionID, "budget_cost")
    expect(after?.phase).toBe("blocked")
    expect(after?.stopReason).toBe("budget_cost")
  })

  test("non-budget goal stop leaves the run untouched", () => {
    const { sessionID } = newRun(50)
    const after = AutonomyRun.recordGoalStop(sessionID, "completed")
    expect(after?.phase).toBe("discover")
  })

  test("terminal runs are not modified", () => {
    const { sessionID, run } = newRun(50)
    AutonomyRun.transition({ id: run.id, expectedRevision: run.revision, event: { type: "cancel" } })
    expect(AutonomyRun.recordGoalReentry(sessionID)?.counters.modelTurns).toBe(0)
    expect(AutonomyRun.recordGoalStop(sessionID, "budget_turns")?.phase).toBe("cancelled")
  })
})

describe("goal judge → autonomy run completion", () => {
  test("judge accept advances an executing run to completed and persists the manifest", async () => {
    const { applySessionMode } = await import("../../src/autonomy/session-mode")
    const { AutonomyGate } = await import("../../src/autonomy")
    const { hashScopeFields, getLatestManifest } = await import("../../src/autonomy/evidence")
    const sessionID = `ses_judge_ok_${Date.now()}`
    const run = applySessionMode({
      mode: "normal",
      scope: "session",
      sessionID,
      projectID: "proj_judge_ok",
      userRequest: "ship it",
    }).run!
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
      questionRequestID: "qr_judge_ok",
      questionIndex: 0,
    })
    AutonomyGate.respondToGate({ gateID: gate.id, answers: [["approved"]], proposalTextNow: proposal, lockedScope })
    expect(AutonomyRun.getRun(run.id)?.phase).toBe("execute")

    const done = AutonomyRun.recordJudgeComplete(sessionID)
    expect(done?.phase).toBe("completed")
    expect(done?.stopReason).toBe("completed")
    expect(done?.evidenceManifestID).toBeDefined()
    expect(getLatestManifest(run.id)?.runID).toBe(run.id)
  })

  test("judge accept leaves a run that never locked requirements untouched", () => {
    const { sessionID } = newRun(50)
    expect(AutonomyRun.recordJudgeComplete(sessionID)?.phase).toBe("discover")
  })

  test("judge failure stop marks the run judge_unavailable", () => {
    const { sessionID } = newRun(50)
    expect(AutonomyRun.recordGoalStop(sessionID, "judge_failed")?.stopReason).toBe("judge_unavailable")
  })
})

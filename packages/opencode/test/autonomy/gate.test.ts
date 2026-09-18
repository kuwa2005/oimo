import { describe, expect, test } from "bun:test"
import { AutonomyRun, AutonomyGate } from "../../src/autonomy"

describe("AutonomyGate", () => {
  test("only the bound question index can approve; other yes is ignored", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_gate_idx",
      projectID: "proj_gate",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "ship feature",
    })
    const proposal = "Lock requirements: implement X with tests"
    const gate = AutonomyGate.createGate({
      runID: run.id,
      kind: "requirements_lock",
      proposalText: proposal,
      questionRequestID: "qr1",
      questionIndex: 1,
    })
    expect(gate.questionIndex).toBe(1)

    const ignore = AutonomyGate.respondToGate({
      gateID: gate.id,
      answers: [["yes"], ["not sure"]],
      proposalTextNow: proposal,
    })
    expect(ignore.status).toBe("pending")

    const ok = AutonomyGate.respondToGate({
      gateID: gate.id,
      answers: [["nope"], ["approved"]],
      proposalTextNow: proposal,
    })
    expect(ok.status).toBe("approved")
    expect(AutonomyRun.getRun(run.id)?.phase).toBe("execute")
  })

  test("proposal hash mismatch expires approval", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_gate_hash",
      projectID: "proj_gate",
      profile: "fde",
      learningLenses: ["fde"],
      userRequest: "field",
    })
    const gate = AutonomyGate.createGate({
      runID: run.id,
      kind: "solution_lock",
      proposalText: "original proposal",
      questionRequestID: "qr2",
      questionIndex: 0,
    })
    const expired = AutonomyGate.respondToGate({
      gateID: gate.id,
      answers: [["approved"]],
      proposalTextNow: "tampered proposal",
    })
    expect(expired.status).toBe("expired")
    expect(AutonomyRun.getRun(run.id)?.phase).not.toBe("execute")
  })
})

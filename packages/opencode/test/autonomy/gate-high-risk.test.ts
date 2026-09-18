import { describe, expect, test } from "bun:test"
import { AutonomyRun, AutonomyGate } from "../../src/autonomy"
import { requiresHighRiskGate } from "../../src/autonomy/safe-auto"

describe("high_risk_action gate E2E", () => {
  test("propose → approve resumes execute", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_hr_ok",
      projectID: "proj_hr",
      profile: "fde",
      learningLenses: ["fde"],
      userRequest: "ship field fix",
    })
    const pending = AutonomyRun.transition({
      id: run.id,
      expectedRevision: run.revision,
      event: { type: "lock_proposed" },
    })
    const locked = AutonomyRun.transition({
      id: pending.id,
      expectedRevision: pending.revision,
      event: {
        type: "lock_approved",
        lockedScope: {
          objective: "ship",
          acceptance_criteria: [],
          in_scope: [],
          out_of_scope: [],
          repositories: [],
          risks: ["external send"],
          hash: "h1",
        },
      },
    })
    expect(locked.phase).toBe("execute")

    const proposal = "Send customer telemetry sample to vendor API"
    const gate = AutonomyGate.proposeHighRiskAction({
      runID: locked.id,
      proposalText: proposal,
      questionRequestID: "qr_hr_1",
    })
    expect(gate.kind).toBe("high_risk_action")
    expect(AutonomyRun.getRun(locked.id)?.phase).toBe("waiting_user")

    const approved = AutonomyGate.respondToGate({
      gateID: gate.id,
      answers: [["approved"]],
      proposalTextNow: proposal,
    })
    expect(approved.status).toBe("approved")
    expect(AutonomyRun.getRun(locked.id)?.phase).toBe("execute")
  })

  test("propose → changes_needed blocks permission", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_hr_deny",
      projectID: "proj_hr",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "delete prod",
    })
    let cur = AutonomyRun.transition({
      id: run.id,
      expectedRevision: run.revision,
      event: { type: "lock_proposed" },
    })
    cur = AutonomyRun.transition({
      id: cur.id,
      expectedRevision: cur.revision,
      event: {
        type: "lock_approved",
        lockedScope: {
          objective: "cleanup",
          acceptance_criteria: [],
          in_scope: [],
          out_of_scope: [],
          repositories: [],
          risks: [],
          hash: "h2",
        },
      },
    })
    const proposal = "rm -rf /var/lib/prod-db"
    const gate = AutonomyGate.proposeHighRiskAction({
      runID: cur.id,
      proposalText: proposal,
      questionRequestID: "qr_hr_2",
      detail: { permission: "bash_delete" },
    })
    cur = AutonomyRun.getRun(cur.id)!
    expect(cur.phase).toBe("waiting_user")

    const denied = AutonomyGate.respondToGate({
      gateID: gate.id,
      answers: [["changes needed"]],
      proposalTextNow: proposal,
    })
    expect(denied.status).toBe("changes_needed")
    cur = AutonomyRun.getRun(cur.id)!
    expect(cur.phase).toBe("blocked")
    expect(cur.stopReason).toBe("blocked_permission")
  })

  test("safe_auto marks network/delete as high-risk permissions", () => {
    expect(requiresHighRiskGate("bash_delete")).toBe(true)
    expect(requiresHighRiskGate("webfetch")).toBe(true)
    expect(requiresHighRiskGate("edit")).toBe(false)
  })

  test("inferGateKind detects high-risk headers", () => {
    expect(AutonomyGate.inferGateKind("High-risk: external send")).toBe("high_risk_action")
    expect(AutonomyGate.inferGateKind("Requirements Lock")).toBe("requirements_lock")
  })
})

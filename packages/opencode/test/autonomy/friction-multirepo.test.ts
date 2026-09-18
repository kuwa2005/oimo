import { describe, expect, test } from "bun:test"
import { applySessionMode } from "../../src/autonomy/session-mode"
import { frictionModesForSession, frictionModesFromLenses } from "../../src/friction/flags"
import { AutonomyRun } from "../../src/autonomy"
import { hashScopeFields } from "../../src/autonomy/evidence"

describe("Friction lenses from Run", () => {
  test("lenses persist on Run independent of profile alias", () => {
    const applied = applySessionMode({
      mode: "se",
      scope: "session",
      sessionID: "ses_friction_1",
      projectID: "proj_friction",
    })
    expect(applied.request.learningLenses).toEqual(["se"])
    expect(applied.run?.learningLenses).toEqual(["se"])
    expect(frictionModesForSession("ses_friction_1")).toEqual(["se"])
  })

  test("--se --fde lenses both persist under profile fde", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_friction_both",
      projectID: "proj_friction",
      profile: "fde",
      learningLenses: ["se", "fde"],
      userRequest: "field problem",
    })
    expect(frictionModesFromLenses(run.learningLenses)).toEqual(["se", "fde"])
    expect(frictionModesForSession("ses_friction_both")).toEqual(["se", "fde"])
  })
})

describe("multi-repo AutonomyRun binding", () => {
  test("repositoryIDs on Run survive lock and are on locked scope", () => {
    const run = AutonomyRun.createRun({
      sessionID: "ses_multi_1",
      projectID: "proj_multi",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "cross-repo fix",
      repositoryIDs: ["primary", "docs-repo"],
    })
    expect(run.repositoryIDs).toEqual(["primary", "docs-repo"])
    const fields = {
      objective: "cross-repo fix",
      acceptance_criteria: ["both repos updated"],
      in_scope: ["primary", "docs-repo"],
      out_of_scope: [],
      repositories: ["primary", "docs-repo"],
      risks: [],
    }
    const lockedScope = { ...fields, hash: hashScopeFields(fields) }
    const pending = AutonomyRun.transition({
      id: run.id,
      expectedRevision: run.revision,
      event: { type: "lock_proposed" },
    })
    const locked = AutonomyRun.transition({
      id: pending.id,
      expectedRevision: pending.revision,
      event: { type: "lock_approved", lockedScope },
    })
    expect(locked.lockedScope?.repositories).toEqual(["primary", "docs-repo"])
    expect(locked.repositoryIDs).toEqual(["primary", "docs-repo"])
  })
})

import { describe, expect, test } from "bun:test"
import { applySessionMode } from "../../src/autonomy/session-mode"
import { AutonomyRun } from "../../src/autonomy"
import { permissionConfigForPreset, safeAutoMayAutoAllow } from "../../src/autonomy/safe-auto"

describe("applySessionMode", () => {
  test("session scope creates run without persistGlobal", () => {
    const result = applySessionMode({
      mode: "normal",
      scope: "session",
      sessionID: "ses_auto_1",
      projectID: "proj_auto",
      userRequest: "build X",
    })
    expect(result.persistGlobal).toBe(false)
    expect(result.request.profile).toBe("se")
    expect(result.request.permissionPreset).toBe("safe_auto")
    expect(result.run?.sessionID).toBe("ses_auto_1")
    expect(result.reLockRequired).toBe(false)
  })

  test("se↔fde clears lock and requires re-lock", () => {
    const created = applySessionMode({
      mode: "normal",
      scope: "session",
      sessionID: "ses_auto_flip",
      projectID: "proj_auto",
    })
    const run = created.run!
    const pending = AutonomyRun.transition({
      id: run.id,
      expectedRevision: run.revision,
      event: { type: "lock_proposed" },
    })
    const locked = AutonomyRun.transition({
      id: run.id,
      expectedRevision: pending.revision,
      event: {
        type: "lock_approved",
        lockedScope: {
          objective: "o",
          acceptance_criteria: ["a"],
          in_scope: [],
          out_of_scope: [],
          repositories: [],
          risks: [],
          hash: "h1",
        },
      },
    })
    expect(locked.lockedScope).toBeTruthy()

    const flipped = applySessionMode({
      mode: "fde",
      scope: "session",
      sessionID: "ses_auto_flip",
      projectID: "proj_auto",
    })
    expect(flipped.reLockRequired).toBe(true)
    expect(flipped.run?.profile).toBe("fde")
    expect(flipped.run?.lockedScope).toBeUndefined()
    expect(flipped.run?.phase).toBe("discover")
    expect(flipped.persistGlobal).toBe(false)
  })

  test("default scope only marks persistGlobal", () => {
    const result = applySessionMode({
      mode: "fde",
      scope: "default",
      projectID: "proj_auto",
    })
    expect(result.persistGlobal).toBe(true)
    expect(result.run).toBeUndefined()
    expect(result.request.profile).toBe("fde")
  })
})

describe("safe_auto preset", () => {
  test("is not allow-all", () => {
    const cfg = permissionConfigForPreset("safe_auto")
    expect(cfg["*"]).toBeUndefined()
    expect(cfg.read).toBe("allow")
    expect(cfg.bash).toBe("ask")
    expect(cfg.external_directory).toBe("ask")
    expect(safeAutoMayAutoAllow("bash_delete")).toBe(false)
    expect(safeAutoMayAutoAllow("edit")).toBe(true)
  })

  test("full_auto is allow-all", () => {
    expect(permissionConfigForPreset("full_auto")["*"]).toBe("allow")
  })
})

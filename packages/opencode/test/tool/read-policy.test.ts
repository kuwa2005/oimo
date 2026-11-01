import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "../../src/global"
import { evaluateReadPolicy, resetReadPolicySession } from "../../src/tool/read-policy"
import { SessionID } from "../../src/session/schema"
import { Instance } from "../../src/project/instance"

const sessionID = SessionID.make("ses_read_policy")

describe("read-policy", () => {
  test("skips re-read of injected session checkpoint", () => {
    resetReadPolicySession(sessionID)
    const checkpoint = path.join(Global.Path.data, "memory", "sessions", sessionID, "checkpoint.md")
    const skip = evaluateReadPolicy({
      filepath: checkpoint,
      sessionID,
      projectID: "unused",
    })
    expect(skip?.output).toContain("memory dedup")
  })

  test("allows offset read on memory artifacts", () => {
    resetReadPolicySession(sessionID)
    const checkpoint = path.join(Global.Path.data, "memory", "sessions", sessionID, "checkpoint.md")
    const skip = evaluateReadPolicy({
      filepath: checkpoint,
      sessionID,
      projectID: "unused",
      offset: 50,
    })
    expect(skip).toBeUndefined()
  })

  test("skips duplicate source reads in the same session", async () => {
    resetReadPolicySession(sessionID)
    const dir = await Bun.$`mktemp -d`.text()
    const trimmed = dir.trim()
    await Instance.provide({
      directory: trimmed,
      fn: () => {
        const file = path.join(trimmed, "src.ts")
        const first = evaluateReadPolicy({
          filepath: file,
          sessionID,
          projectID: "unused",
        })
        expect(first).toBeUndefined()
        const second = evaluateReadPolicy({
          filepath: file,
          sessionID,
          projectID: "unused",
        })
        expect(second?.output).toContain("duplicate")
      },
    })
  })
})

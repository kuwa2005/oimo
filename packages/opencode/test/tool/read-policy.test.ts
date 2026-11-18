import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "../../src/global"
import {
  evaluateReadPolicy,
  evaluateContentHashDedup,
  fingerprintFileContent,
  resetReadPolicySession,
} from "../../src/tool/read-policy"
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

  test("content hash dedup shortens unchanged re-read", () => {
    resetReadPolicySession(sessionID)
    const fp = fingerprintFileContent("hello\nworld")
    const file = "/tmp/read-policy-same.txt"
    expect(
      evaluateContentHashDedup({
        filepath: file,
        sessionID,
        fingerprint: fp,
        limit: 2000,
        previewLines: ["hello", "world"],
      }),
    ).toBeUndefined()
    const second = evaluateContentHashDedup({
      filepath: file,
      sessionID,
      fingerprint: fp,
      limit: 2000,
      previewLines: ["hello", "world"],
    })
    expect(second?.output).toContain("unchanged content")
    const forced = evaluateContentHashDedup({
      filepath: file,
      sessionID,
      fingerprint: fp,
      limit: 2000,
      force: true,
      previewLines: ["hello", "world"],
    })
    expect(forced).toBeUndefined()
  })

  test("content hash dedup does not skip a wider read of unchanged content", () => {
    resetReadPolicySession(sessionID)
    const fp = fingerprintFileContent("a\nb\nc")
    const file = "/tmp/read-policy-wider.txt"
    const read = (limit: number) =>
      evaluateContentHashDedup({ filepath: file, sessionID, fingerprint: fp, limit, previewLines: ["a"] })
    expect(read(50)).toBeUndefined()
    expect(read(2000)).toBeUndefined()
    expect(read(2000)?.output).toContain("unchanged content")
    expect(read(50)?.output).toContain("unchanged content")
  })
})

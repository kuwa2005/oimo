import { describe, expect, test } from "bun:test"
import { AutonomyGate, AutonomyRun } from "../../src/autonomy"
import { applySessionMode, sessionAutonomyConfig } from "../../src/autonomy/session-mode"
import { buildManifest, getLatestManifest, hashScopeFields } from "../../src/autonomy/evidence"
import { classifyVerificationCommand, recordTestAttempt, listTestAttempts } from "../../src/autonomy/test-attempt"
import * as ConfigAutonomy from "../../src/config/autonomy"

const sid = (tag: string) => `ses_issue_${tag}_${Date.now()}_${Math.random().toString(36).slice(2)}`
const scope = () => {
  const fields = {
    objective: "x",
    acceptance_criteria: ["ok"],
    in_scope: [],
    out_of_scope: [],
    repositories: [],
    risks: [],
  }
  return { ...fields, hash: hashScopeFields(fields) }
}

describe("#71 session-scoped /auto does not leak", () => {
  test("a session's run overrides the instance config; other sessions keep the instance mode", () => {
    const instanceCfg = ConfigAutonomy.patchForMode("se")
    const fdeSession = sid("fde")
    applySessionMode({ mode: "fde", scope: "session", sessionID: fdeSession, projectID: "p71" })
    expect(ConfigAutonomy.mode(sessionAutonomyConfig(instanceCfg, fdeSession))).toBe("fde")
    expect(ConfigAutonomy.mode(sessionAutonomyConfig(instanceCfg, sid("other")))).toBe("se")
  })

  test("session-scoped off overrides an instance-wide autonomy default", () => {
    const instanceCfg = ConfigAutonomy.patchForMode("se")
    const offSession = sid("off")
    applySessionMode({ mode: "none", scope: "session", sessionID: offSession, projectID: "p71" })
    expect(ConfigAutonomy.enabled(sessionAutonomyConfig(instanceCfg, offSession))).toBe(false)
    const switched = sid("off2")
    applySessionMode({ mode: "se", scope: "session", sessionID: switched, projectID: "p71" })
    applySessionMode({ mode: "none", scope: "session", sessionID: switched, projectID: "p71" })
    expect(ConfigAutonomy.enabled(sessionAutonomyConfig(instanceCfg, switched))).toBe(false)
    applySessionMode({ mode: "fde", scope: "session", sessionID: switched, projectID: "p71" })
    expect(ConfigAutonomy.mode(sessionAutonomyConfig({}, switched))).toBe("fde")
  })

  test("a completed run keeps the session's mode for the next task", () => {
    const session = sid("done")
    const run = applySessionMode({ mode: "fde", scope: "session", sessionID: session, projectID: "p71" }).run!
    AutonomyRun.transition({ id: run.id, expectedRevision: run.revision, event: { type: "cancel" } })
    // legacy cancel (profile kept) falls back to the instance config
    expect(ConfigAutonomy.mode(sessionAutonomyConfig({}, session))).toBe("none")
  })
})

describe("#67 Requirements Lock records the approved proposal", () => {
  test("lockedScope.objective is the approved proposal text when no scope is passed", () => {
    const session = sid("lock")
    const run = AutonomyGate.ensureRunForSession({ sessionID: session, projectID: "p67" })
    const proposal = "要件: CSV を取り込み月次集計を出力する。受け入れ: 既存の3ファイルで一致"
    AutonomyGate.handleQuestionLock({
      sessionID: session,
      projectID: "p67",
      questionRequestID: "qr67",
      questions: [{ header: "Requirements Lock", question: proposal }],
      answers: [["Approved"]],
    })
    const locked = AutonomyRun.getRun(run.id)!
    expect(locked.phase).toBe("execute")
    expect(locked.lockedScope?.objective).toBe(proposal)
  })
})

describe("#73 lock headers and pre-lock high-risk gates", () => {
  test("lock keywords win over high-risk keywords", () => {
    expect(AutonomyGate.inferGateKind("Solution Lock (production rollout)")).toBe("solution_lock")
    expect(AutonomyGate.inferGateKind("Requirements Lock — credential rotation")).toBe("requirements_lock")
    expect(AutonomyGate.inferGateKind("production deploy")).toBe("high_risk_action")
  })

  test("approving a high-risk gate before the lock neither throws nor skips the lock", () => {
    const session = sid("hr")
    const run = AutonomyGate.ensureRunForSession({ sessionID: session, projectID: "p73", profile: "fde" })
    const result = AutonomyGate.handleQuestionLock({
      sessionID: session,
      projectID: "p73",
      questionRequestID: "qr73",
      questions: [{ header: "High risk: external send", question: "送信してよいか" }],
      answers: [["Approved"]],
    })
    expect(result.locked).toBe(false)
    expect(AutonomyRun.getRun(run.id)?.phase).toBe("discover")
  })
})

describe("#69 verification command detection", () => {
  test("detects common test runners and separates typecheck", () => {
    for (const cmd of [
      "bun test",
      "bun run test",
      "cd pkg && npm test -- --watch=false",
      "pnpm test",
      "go test ./...",
      "cargo test",
      "node --test",
      "make test",
      "npx playwright test",
      "python -m pytest -q",
      "pytest tests/",
    ])
      expect(classifyVerificationCommand(cmd)).toBe("test")
    expect(classifyVerificationCommand("bun typecheck")).toBe("check")
    expect(classifyVerificationCommand("npx tsc --noEmit")).toBe("check")
    expect(classifyVerificationCommand("ls tests")).toBeUndefined()
    expect(classifyVerificationCommand("cat latest.txt")).toBeUndefined()
  })
})

describe("#72 FDE PoC attempts and metrics", () => {
  test("PoC attempts and metrics are kept separately in the manifest", () => {
    const session = sid("poc")
    const run = AutonomyRun.createRun({
      sessionID: session,
      projectID: "p72",
      profile: "fde",
      learningLenses: ["fde"],
      userRequest: "x",
    })
    const base = {
      runID: run.id,
      command: ["bash", "-lc", "bun test"],
      environmentFingerprint: "env",
      startedAt: Date.now(),
      durationMs: 5,
      exitCode: 0,
      status: "passed" as const,
    }
    const poc = recordTestAttempt({ ...base, kind: "poc", codeRevision: "1" })
    const real = recordTestAttempt({ ...base, kind: "test", codeRevision: "9" })
    expect(listTestAttempts(run.id).find((a) => a.id === poc.id)?.kind).toBe("poc")
    const manifest = buildManifest({
      runID: run.id,
      lockedScope: scope(),
      codeRevision: "9",
      metrics: [{ name: "集計時間", before: 120, after: 5, unit: "min" }],
    })
    expect(manifest.pocAttemptIDs).toEqual([poc.id])
    expect(manifest.testAttemptIDs).toEqual([real.id])
    expect(manifest.metrics?.[0]?.after).toBe(5)
    expect(getLatestManifest(run.id)?.metrics?.[0]?.name).toBe("集計時間")
  })
})

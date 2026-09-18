import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as RepoWorkspace from "../../src/repo-workspace"
import { AutonomyRun, AutonomyGate } from "../../src/autonomy"
import { applySessionMode } from "../../src/autonomy/session-mode"
import { hashScopeFields, buildManifest, judgeFromManifest } from "../../src/autonomy/evidence"
import { planVerification, classifyChangeKind } from "../../src/autonomy/verify-plan"
import { recordTestAttempt, failureSignature, classifyFailure } from "../../src/autonomy/test-attempt"

const dirs: string[] = []

function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oimo-auto-multi-"))
  dirs.push(dir)
  return dir
}

function gitInit(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  expect(Bun.spawnSync(["git", "init"], { cwd: dir }).exitCode).toBe(0)
  Bun.spawnSync(["git", "config", "user.email", "t@t.com"], { cwd: dir })
  Bun.spawnSync(["git", "config", "user.name", "t"], { cwd: dir })
  fs.writeFileSync(path.join(dir, "README.md"), "#\n")
  Bun.spawnSync(["git", "add", "."], { cwd: dir })
  Bun.spawnSync(["git", "commit", "-m", "i"], { cwd: dir })
}

afterEach(() => {
  RepoWorkspace.ChangeSet.clearChangeSets()
  RepoWorkspace.Scope.clearAllScopes()
  RepoWorkspace.DirtyBaseline.clearBaselines()
  while (dirs.length) {
    const d = dirs.pop()
    if (d) fs.rmSync(d, { recursive: true, force: true })
  }
})

describe("live multi-repo workspace + AutonomyRun E2E", () => {
  test("fixture workspace binds repositoryIDs through lock → verify → judge", async () => {
    const root = tmpRoot()
    const backend = path.join(root, "backend")
    const frontend = path.join(root, "frontend")
    const schema = path.join(root, "shared-schema")
    for (const d of [backend, frontend, schema]) gitInit(d)

    fs.mkdirSync(path.join(backend, ".oimo"), { recursive: true })
    const configPath = path.join(backend, ".oimo", "workspace.yaml")
    fs.writeFileSync(
      configPath,
      [
        "version: 1",
        "name: autonomy-multi",
        "primary: backend",
        "repositories:",
        "  - id: backend",
        "    path: .",
        "  - id: frontend",
        "    path: ../frontend",
        "  - id: shared-schema",
        "    path: ../shared-schema",
      ].join("\n"),
    )

    const info = await RepoWorkspace.loadFromFile(configPath, backend)
    const repoIDs = [...info.repositories.keys()]
    expect(repoIDs).toEqual(expect.arrayContaining(["backend", "frontend", "shared-schema"]))

    const sessionID = "ses_multi_live_1"
    const fingerprint = RepoWorkspace.SessionFingerprint.workspaceFingerprintKey(info)

    applySessionMode({
      mode: "se",
      scope: "session",
      sessionID,
      projectID: "proj_multi_live",
      userRequest: "rename DisplayName across schema/backend/frontend",
    })
    // Cancel bootstrap run if any — recreate with multi-repo binding.
    const prior = AutonomyRun.getLatestRunForSession(sessionID)
    if (prior && prior.phase !== "cancelled" && prior.phase !== "completed") {
      AutonomyRun.transition({
        id: prior.id,
        expectedRevision: prior.revision,
        event: { type: "cancel" },
      })
    }

    let run = AutonomyRun.createRun({
      sessionID,
      projectID: "proj_multi_live",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "rename DisplayName across schema/backend/frontend",
      workspaceFingerprint: fingerprint,
      repositoryIDs: repoIDs,
    })
    expect(run.repositoryIDs).toEqual(repoIDs)
    expect(run.workspaceFingerprint).toBe(fingerprint)

    const impact = await RepoWorkspace.Graph.analyzeImpact(info, { query: "DisplayName" })
    const plan = RepoWorkspace.Plan.planFromImpact({ title: "schema rename", impact })
    const started = RepoWorkspace.Plan.beginChangeSet({
      sessionID,
      info,
      plan,
      autoApprove: true,
    })
    RepoWorkspace.ChangeSet.saveChangeSet(started.changeSet)
    RepoWorkspace.Scope.setScope(sessionID, started.changeSet.executionScope)

    const schemaWrite = RepoWorkspace.Policy.decideWrite(info, sessionID, {
      repositoryId: "shared-schema",
      path: "openapi.yaml",
    })
    expect(schemaWrite.ok).toBe(true)

    const vplan = planVerification(
      classifyChangeKind({
        paths: ["shared-schema/openapi.yaml", "backend/src/api.ts", "frontend/src/ui.tsx"],
        touchesTests: true,
      }),
    )
    const fields = {
      objective: "rename DisplayName",
      acceptance_criteria: ["focused test passes on current revision"],
      in_scope: repoIDs,
      out_of_scope: ["infra"],
      repositories: repoIDs,
      risks: [],
      verification_plan: vplan as unknown as Record<string, unknown>,
    }
    const lockedScope = { ...fields, hash: hashScopeFields(fields) }
    const proposal = JSON.stringify(lockedScope)

    const gate = AutonomyGate.createGate({
      runID: run.id,
      kind: "requirements_lock",
      proposalText: proposal,
      questionRequestID: "qr_multi",
      questionIndex: 0,
    })
    const approved = AutonomyGate.respondToGate({
      gateID: gate.id,
      answers: [["approved"]],
      proposalTextNow: proposal,
      lockedScope,
    })
    expect(approved.status).toBe("approved")

    let cur = AutonomyRun.getRun(run.id)!
    expect(cur.phase).toBe("execute")
    expect(cur.lockedScope?.repositories).toEqual(repoIDs)
    expect(cur.repositoryIDs).toEqual(repoIDs)

    cur = AutonomyRun.transition({
      id: cur.id,
      expectedRevision: cur.revision,
      event: { type: "implementation_done" },
    })
    expect(cur.phase).toBe("verify")

    const cmd = ["bun", "test", "test/display-name.test.ts"]
    recordTestAttempt({
      runID: cur.id,
      command: cmd,
      environmentFingerprint: "ci-linux",
      codeRevision: "rev_multi",
      startedAt: Date.now(),
      durationMs: 12,
      exitCode: 0,
      status: "passed",
      failureSignature: failureSignature({ command: cmd, exitCode: 0 }),
      failureClass: classifyFailure({ status: "passed" }),
      cwdRepositoryID: "backend",
    })

    cur = AutonomyRun.transition({
      id: cur.id,
      expectedRevision: cur.revision,
      event: { type: "verify_passed" },
    })
    expect(cur.phase).toBe("judge")

    const manifest = buildManifest({
      runID: cur.id,
      lockedScope,
      codeRevision: "rev_multi",
      changedFiles: ["shared-schema/openapi.yaml", "backend/src/api.ts", "frontend/src/ui.tsx"],
    })
    expect(manifest.unresolved).toEqual([])
    const verdict = judgeFromManifest({
      lockedScope,
      manifest,
      judgeAvailable: true,
    })
    expect(verdict.status).toBe("complete")

    cur = AutonomyRun.transition({
      id: cur.id,
      expectedRevision: cur.revision,
      event: { type: "judge_complete" },
    })
    expect(cur.phase).toBe("completed")
    expect(RepoWorkspace.ChangeSet.loadChangeSet(sessionID)?.id).toBe(started.changeSet.id)
  })
})

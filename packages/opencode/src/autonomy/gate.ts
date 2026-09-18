/**
 * Structured Autonomy Lock Gate (complete-spec §8).
 * Approval binds to gate ID + question index + proposal hash — not header regex alone.
 */
import { createHash, randomBytes } from "crypto"
import { Database, eq, and, desc } from "@/storage"
import { AutonomyGateTable, AutonomyRunTable } from "./autonomy.sql"
import { getLatestRunForSession, getRun, transition, appendAudit, createRun } from "./run"
import type { LockedScope } from "./autonomy.sql"
import type { AutonomyProfile, LearningLens } from "./resolve"

export type GateKind = "requirements_lock" | "solution_lock" | "high_risk_action"

export type GateStatus = "pending" | "approved" | "changes_needed" | "expired"

export type AutonomyGateRecord = {
  id: string
  runID: string
  kind: GateKind
  revision: number
  proposalHash: string
  questionRequestID: string
  questionIndex: number
  status: GateStatus
  detail?: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

const APPROVED_RE = /(approved|looks good|proceed|yes|ok|lgtm|承認|確定|進めて|問題ない)/i
const CHANGES_RE = /(changes?\s*needed|revise|変更|やり直し)/i

export function proposalHash(text: string) {
  return createHash("sha256").update(text).digest("hex")
}

function newGateID() {
  return `agate_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`
}

function rowToGate(row: typeof AutonomyGateTable.$inferSelect): AutonomyGateRecord {
  return {
    id: row.id,
    runID: row.run_id,
    kind: row.kind as GateKind,
    revision: row.revision,
    proposalHash: row.proposal_hash,
    questionRequestID: row.question_request_id,
    questionIndex: row.question_index,
    status: row.status as GateStatus,
    detail: row.detail ?? undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

export function getGate(id: string): AutonomyGateRecord | undefined {
  const row = Database.Client().select().from(AutonomyGateTable).where(eq(AutonomyGateTable.id, id)).get()
  if (!row) return
  return rowToGate(row)
}

export function getPendingGateForRun(runID: string): AutonomyGateRecord | undefined {
  const row = Database.Client()
    .select()
    .from(AutonomyGateTable)
    .where(and(eq(AutonomyGateTable.run_id, runID), eq(AutonomyGateTable.status, "pending")))
    .orderBy(desc(AutonomyGateTable.time_updated))
    .limit(1)
    .get()
  if (!row) return
  return rowToGate(row)
}

export function createGate(input: {
  runID: string
  kind: GateKind
  proposalText: string
  questionRequestID: string
  questionIndex: number
  detail?: Record<string, unknown>
}): AutonomyGateRecord {
  const run = getRun(input.runID)
  if (!run) throw new Error(`autonomy run not found: ${input.runID}`)
  const now = Date.now()
  const id = newGateID()
  const hash = proposalHash(input.proposalText)
  Database.Client()
    .insert(AutonomyGateTable)
    .values({
      id,
      run_id: input.runID,
      kind: input.kind,
      revision: run.revision,
      proposal_hash: hash,
      question_request_id: input.questionRequestID,
      question_index: input.questionIndex,
      status: "pending",
      detail: input.detail,
      time_created: now,
      time_updated: now,
    })
    .run()

  Database.Client()
    .update(AutonomyRunTable)
    .set({ active_gate_id: id, time_updated: now })
    .where(eq(AutonomyRunTable.id, input.runID))
    .run()

  const attached = getRun(input.runID)!
  if (input.kind === "high_risk_action") {
    if (attached.phase === "execute" || attached.phase === "verify" || attached.phase === "judge") {
      transition({
        id: attached.id,
        expectedRevision: attached.revision,
        event: { type: "high_risk_proposed" },
        eventID: id,
      })
    }
  } else if (attached.phase === "discover" || attached.phase === "waiting_user") {
    transition({
      id: attached.id,
      expectedRevision: attached.revision,
      event: { type: "lock_proposed" },
      eventID: id,
    })
  }

  appendAudit({
    runID: input.runID,
    projectID: run.projectID,
    type: "gate_created",
    detail: { gateID: id, kind: input.kind, questionIndex: input.questionIndex, hash },
  })

  return getGate(id)!
}

/**
 * Respond using ONLY the answer at gate.questionIndex.
 * Other questions' "yes" cannot approve the lock (blocker #11).
 */
export function respondToGate(input: {
  gateID: string
  answers: ReadonlyArray<ReadonlyArray<string> | undefined>
  proposalTextNow: string
  lockedScope?: LockedScope
}): {
  status: GateStatus
  runID: string
  sessionID?: string
  kind: GateKind
} {
  const gate = getGate(input.gateID)
  if (!gate) throw new Error(`gate not found: ${input.gateID}`)
  if (gate.status !== "pending") {
    return { status: gate.status, runID: gate.runID, kind: gate.kind }
  }

  const run = getRun(gate.runID)
  if (!run) throw new Error(`run missing for gate ${gate.id}`)

  const currentHash = proposalHash(input.proposalTextNow)
  if (currentHash !== gate.proposalHash) {
    Database.Client()
      .update(AutonomyGateTable)
      .set({ status: "expired", time_updated: Date.now() })
      .where(eq(AutonomyGateTable.id, gate.id))
      .run()
    appendAudit({
      runID: run.id,
      projectID: run.projectID,
      type: "gate_expired",
      detail: { gateID: gate.id, reason: "proposal_hash_mismatch" },
    })
    return { status: "expired", runID: gate.runID, sessionID: run.sessionID, kind: gate.kind }
  }

  const answerAtIndex = input.answers[gate.questionIndex] ?? []
  const joined = answerAtIndex.join(" ").trim()
  let status: GateStatus = "pending"
  if (joined && APPROVED_RE.test(joined)) status = "approved"
  if (joined && CHANGES_RE.test(joined)) status = "changes_needed"

  if (status === "pending") {
    return { status: "pending", runID: gate.runID, sessionID: run.sessionID, kind: gate.kind }
  }

  Database.Client()
    .update(AutonomyGateTable)
    .set({ status, time_updated: Date.now() })
    .where(eq(AutonomyGateTable.id, gate.id))
    .run()

  const fresh = getRun(gate.runID)!
  if (gate.kind === "high_risk_action") {
    if (status === "approved") {
      transition({
        id: fresh.id,
        expectedRevision: fresh.revision,
        event: { type: "high_risk_approved" },
        eventID: gate.id,
      })
    } else if (status === "changes_needed") {
      transition({
        id: fresh.id,
        expectedRevision: fresh.revision,
        event: { type: "high_risk_denied", reason: "blocked_permission" },
        eventID: gate.id,
      })
    }
  } else if (status === "approved") {
    const scope =
      input.lockedScope ??
      ({
        objective: fresh.userRequest.slice(0, 500),
        acceptance_criteria: [],
        in_scope: [],
        out_of_scope: [],
        repositories: fresh.repositoryIDs,
        risks: [],
        hash: gate.proposalHash,
      } satisfies LockedScope)
    transition({
      id: fresh.id,
      expectedRevision: fresh.revision,
      event: { type: "lock_approved", lockedScope: scope },
      eventID: gate.id,
    })
  } else if (status === "changes_needed") {
    transition({
      id: fresh.id,
      expectedRevision: fresh.revision,
      event: { type: "lock_changes_needed" },
      eventID: gate.id,
    })
  }

  appendAudit({
    runID: run.id,
    projectID: run.projectID,
    type: "gate_responded",
    detail: { gateID: gate.id, status, questionIndex: gate.questionIndex },
  })

  return { status, runID: gate.runID, sessionID: run.sessionID, kind: gate.kind }
}

export function inferGateKind(header?: string): GateKind | undefined {
  if (!header) return
  if (/high[\s_-]*risk|外部送信|production|顧客データ|credential|force\s*push|課金/i.test(header)) {
    return "high_risk_action"
  }
  if (/solution\s*lock|解決策ロック|ソリューションロック|方針確定/i.test(header)) return "solution_lock"
  if (/requirements?\s*lock|spec\s*lock|仕様確定|要件ロック|要件確定/i.test(header)) return "requirements_lock"
  return
}

/** Permissions / intents that must surface a high_risk_action gate under autonomy. */
export function isHighRiskPermission(permission: string): boolean {
  return (
    permission === "bash_delete" ||
    permission === "external_directory" ||
    permission === "webfetch" ||
    permission === "websearch" ||
    permission === "doom_loop"
  )
}

/**
 * Open a high_risk_action gate for an in-flight run (execute/verify/judge).
 * Approval resumes execute; changes_needed blocks with blocked_permission.
 */
export function proposeHighRiskAction(input: {
  runID: string
  proposalText: string
  questionRequestID: string
  questionIndex?: number
  detail?: Record<string, unknown>
}): AutonomyGateRecord {
  return createGate({
    runID: input.runID,
    kind: "high_risk_action",
    proposalText: input.proposalText,
    questionRequestID: input.questionRequestID,
    questionIndex: input.questionIndex ?? 0,
    detail: input.detail,
  })
}

export function ensureRunForSession(input: {
  sessionID: string
  projectID: string
  profile?: AutonomyProfile
  learningLenses?: LearningLens[]
  userRequest?: string
}) {
  const existing = getLatestRunForSession(input.sessionID)
  if (existing && existing.phase !== "completed" && existing.phase !== "cancelled") return existing
  return createRun({
    sessionID: input.sessionID,
    projectID: input.projectID,
    profile: input.profile ?? "se",
    learningLenses: input.learningLenses ?? ["se"],
    userRequest: input.userRequest ?? "(autonomy lock)",
  })
}

export function handleQuestionLock(input: {
  sessionID: string
  projectID: string
  questionRequestID: string
  questions: Array<{ header?: string; question: string }>
  answers: ReadonlyArray<ReadonlyArray<string> | undefined>
  profile?: AutonomyProfile
  learningLenses?: LearningLens[]
}): { locked: boolean; kind?: GateKind; gateID?: string; status?: GateStatus } {
  const lockIndexes = input.questions
    .map((q, i) => ({ i, kind: inferGateKind(q.header) }))
    .filter((x): x is { i: number; kind: GateKind } => Boolean(x.kind))

  if (!lockIndexes.length) return { locked: false }

  const run = ensureRunForSession({
    sessionID: input.sessionID,
    projectID: input.projectID,
    profile: input.profile,
    learningLenses: input.learningLenses,
  })

  const primary = lockIndexes[0]!
  const proposalText = input.questions[primary.i]?.question ?? ""

  let gate = getPendingGateForRun(run.id)
  if (!gate) {
    gate = createGate({
      runID: run.id,
      kind: primary.kind,
      proposalText,
      questionRequestID: input.questionRequestID,
      questionIndex: primary.i,
    })
  }

  const result = respondToGate({
    gateID: gate.id,
    answers: input.answers,
    proposalTextNow: proposalText,
  })

  return {
    locked: result.status === "approved",
    kind: result.kind,
    gateID: gate.id,
    status: result.status,
  }
}

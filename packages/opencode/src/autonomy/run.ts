/**
 * AutonomyRun state machine — typed transitions with revision CAS.
 */
import { randomBytes } from "crypto"
import { Database, eq, and, desc } from "@/storage"
import {
  AutonomyRunTable,
  AutonomyRunAuditTable,
  type AutonomyRunRecord,
  type AutonomyPhase,
  type AutonomyStopReason,
  type AutonomyBudgets,
  type AutonomyCounters,
  type LockedScope,
} from "./autonomy.sql"
import type { AutonomyProfile, LearningLens } from "./resolve"
import * as ConfigAutonomy from "@/config/autonomy"

const ALLOWED: Record<AutonomyPhase, AutonomyPhase[]> = {
  discover: ["lock_pending", "waiting_user", "blocked", "cancelled"],
  lock_pending: ["discover", "execute", "waiting_user", "cancelled"],
  execute: ["verify", "blocked", "waiting_user", "cancelled"],
  verify: ["judge", "execute", "blocked", "cancelled"],
  judge: ["completed", "execute", "verify", "waiting_user", "blocked", "cancelled"],
  waiting_user: ["discover", "lock_pending", "execute", "cancelled"],
  completed: [],
  blocked: ["discover", "execute", "waiting_user", "cancelled"],
  cancelled: [],
}

export type AutonomyEvent =
  | { type: "ask_user" }
  | { type: "lock_proposed" }
  | { type: "lock_approved"; lockedScope: LockedScope }
  | { type: "lock_changes_needed" }
  | { type: "resume" }
  | { type: "implementation_done" }
  | { type: "verify_passed" }
  | { type: "verify_failed" }
  | { type: "judge_complete" }
  | { type: "judge_rework"; next: "execute" | "verify" }
  | { type: "block"; reason: AutonomyStopReason }
  | { type: "cancel" }

function newRunID() {
  return `arun_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`
}

function newAuditID() {
  return `araud_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`
}

function rowToRecord(row: typeof AutonomyRunTable.$inferSelect): AutonomyRunRecord {
  return {
    id: row.id,
    sessionID: row.session_id,
    projectID: row.project_id,
    workspaceFingerprint: row.workspace_fingerprint ?? undefined,
    repositoryIDs: row.repository_ids,
    changesetID: row.changeset_id ?? undefined,
    profile: row.profile,
    learningLenses: row.learning_lenses,
    phase: row.phase,
    revision: row.revision,
    userRequest: row.user_request,
    lockedScope: row.locked_scope ?? undefined,
    activeGateID: row.active_gate_id ?? undefined,
    evidenceManifestID: row.evidence_manifest_id ?? undefined,
    budgets: row.budgets,
    counters: row.counters,
    stopReason: row.stop_reason ?? undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

function defaultBudgets(): AutonomyBudgets {
  const lim = ConfigAutonomy.limits()
  return {
    maxTurns: lim.maxTurns,
    maxDurationMs: lim.maxDurationMs,
    maxCostUsd: lim.maxCostUsd,
    judgeMaxRetries: lim.judgeMaxRetries,
    maxTestAttempts: 20,
    maxAttemptsPerSignature: 2,
  }
}

function defaultCounters(): AutonomyCounters {
  return { modelTurns: 0, judgeAttempts: 0, testAttempts: 0, reworkCount: 0 }
}

export function createRun(input: {
  sessionID: string
  projectID: string
  profile: AutonomyProfile
  learningLenses: LearningLens[]
  userRequest: string
  workspaceFingerprint?: string
  repositoryIDs?: string[]
  budgets?: Partial<AutonomyBudgets>
}): AutonomyRunRecord {
  const now = Date.now()
  const id = newRunID()
  const budgets = { ...defaultBudgets(), ...input.budgets }
  Database.Client()
    .insert(AutonomyRunTable)
    .values({
      id,
      session_id: input.sessionID,
      project_id: input.projectID,
      workspace_fingerprint: input.workspaceFingerprint,
      repository_ids: input.repositoryIDs ?? [],
      profile: input.profile,
      learning_lenses: input.learningLenses,
      phase: "discover",
      revision: 1,
      user_request: input.userRequest,
      budgets,
      counters: defaultCounters(),
      time_created: now,
      time_updated: now,
    })
    .run()
  appendAudit({
    runID: id,
    projectID: input.projectID,
    type: "created",
    detail: { profile: input.profile, lenses: input.learningLenses },
  })
  return getRun(id)!
}

export function getRun(id: string): AutonomyRunRecord | undefined {
  const row = Database.Client().select().from(AutonomyRunTable).where(eq(AutonomyRunTable.id, id)).get()
  if (!row) return
  return rowToRecord(row)
}

export function getLatestRunForSession(sessionID: string): AutonomyRunRecord | undefined {
  const row = Database.Client()
    .select()
    .from(AutonomyRunTable)
    .where(eq(AutonomyRunTable.session_id, sessionID))
    .orderBy(desc(AutonomyRunTable.time_updated))
    .limit(1)
    .get()
  if (!row) return
  return rowToRecord(row)
}

function nextPhase(current: AutonomyPhase, event: AutonomyEvent): {
  phase: AutonomyPhase
  stopReason?: AutonomyStopReason
  lockedScope?: LockedScope
} {
  if (event.type === "cancel") return { phase: "cancelled", stopReason: "cancelled_by_user" }
  if (event.type === "block") return { phase: "blocked", stopReason: event.reason }
  if (event.type === "ask_user") return { phase: "waiting_user", stopReason: "waiting_for_required_input" }
  if (event.type === "lock_proposed") return { phase: "lock_pending", stopReason: "waiting_for_lock" }
  if (event.type === "lock_changes_needed") return { phase: "discover" }
  if (event.type === "lock_approved") return { phase: "execute", lockedScope: event.lockedScope }
  if (event.type === "resume") {
    if (current === "waiting_user") return { phase: "discover" }
    return { phase: current }
  }
  if (event.type === "implementation_done") return { phase: "verify" }
  if (event.type === "verify_passed") return { phase: "judge" }
  if (event.type === "verify_failed") return { phase: "execute" }
  if (event.type === "judge_complete") return { phase: "completed", stopReason: "completed" }
  if (event.type === "judge_rework") return { phase: event.next }
  return { phase: current, stopReason: "invalid_state" }
}

export function transition(input: {
  id: string
  expectedRevision: number
  event: AutonomyEvent
  eventID?: string
}): AutonomyRunRecord {
  const current = getRun(input.id)
  if (!current) throw new Error(`autonomy run not found: ${input.id}`)
  if (current.revision !== input.expectedRevision) {
    throw new Error(
      `autonomy revision conflict: expected ${input.expectedRevision}, have ${current.revision}`,
    )
  }

  const computed = nextPhase(current.phase, input.event)
  if (computed.stopReason === "invalid_state" && computed.phase === current.phase) {
    appendAudit({
      runID: current.id,
      projectID: current.projectID,
      type: "invalid_state",
      detail: { phase: current.phase, event: input.event, eventID: input.eventID },
    })
    throw new Error(`invalid autonomy transition from ${current.phase} via ${input.event.type}`)
  }

  const allowed = ALLOWED[current.phase] ?? []
  if (!allowed.includes(computed.phase) && computed.phase !== current.phase) {
    appendAudit({
      runID: current.id,
      projectID: current.projectID,
      type: "illegal_transition",
      detail: { from: current.phase, to: computed.phase, event: input.event.type },
    })
    throw new Error(`illegal autonomy transition ${current.phase} → ${computed.phase}`)
  }

  const now = Date.now()
  const nextRevision = current.revision + 1
  Database.Client()
    .update(AutonomyRunTable)
    .set({
      phase: computed.phase,
      revision: nextRevision,
      stop_reason: computed.stopReason ?? null,
      locked_scope: computed.lockedScope ?? current.lockedScope,
      time_updated: now,
    })
    .where(and(eq(AutonomyRunTable.id, input.id), eq(AutonomyRunTable.revision, input.expectedRevision)))
    .run()

  const after = getRun(input.id)
  if (!after || after.revision !== nextRevision) {
    throw new Error(`autonomy revision CAS failed for ${input.id}`)
  }

  appendAudit({
    runID: current.id,
    projectID: current.projectID,
    type: "transition",
    detail: {
      from: current.phase,
      to: computed.phase,
      event: input.event.type,
      eventID: input.eventID,
      revision: nextRevision,
    },
  })
  return after
}

export function appendAudit(input: {
  runID: string
  projectID: string
  type: string
  detail?: Record<string, unknown>
}) {
  Database.Client()
    .insert(AutonomyRunAuditTable)
    .values({
      id: newAuditID(),
      run_id: input.runID,
      project_id: input.projectID,
      type: input.type,
      detail: input.detail,
      time_created: Date.now(),
    })
    .run()
}

export function listAudit(runID: string) {
  return Database.Client()
    .select()
    .from(AutonomyRunAuditTable)
    .where(eq(AutonomyRunAuditTable.run_id, runID))
    .orderBy(desc(AutonomyRunAuditTable.time_created))
    .all()
}

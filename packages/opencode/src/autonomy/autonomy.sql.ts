/**
 * AutonomyRun durable records (FDE/SE improvement §5.2 / §6).
 */
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import type { AutonomyProfile, LearningLens } from "./resolve"

export type AutonomyPhase =
  | "discover"
  | "lock_pending"
  | "execute"
  | "verify"
  | "judge"
  | "waiting_user"
  | "completed"
  | "blocked"
  | "cancelled"

export type AutonomyStopReason =
  | "completed"
  | "waiting_for_lock"
  | "waiting_for_required_input"
  | "blocked_environment"
  | "blocked_permission"
  | "blocked_dependency"
  | "budget_model_turns"
  | "budget_test_attempts"
  | "budget_judge_attempts"
  | "budget_duration"
  | "budget_cost"
  | "judge_unavailable"
  | "repeated_failure"
  | "cancelled_by_user"
  | "invalid_state"

export type AutonomyBudgets = {
  maxTurns: number
  maxDurationMs: number
  maxCostUsd: number
  judgeMaxRetries: number
  maxTestAttempts?: number
  maxAttemptsPerSignature?: number
}

export type AutonomyCounters = {
  modelTurns: number
  judgeAttempts: number
  testAttempts: number
  reworkCount: number
}

export type LockedScope = {
  objective: string
  acceptance_criteria: string[]
  in_scope: string[]
  out_of_scope: string[]
  repositories: string[]
  risks: string[]
  verification_plan?: Record<string, unknown>
  hash: string
}

export type AutonomyRunRecord = {
  id: string
  sessionID: string
  projectID: string
  workspaceFingerprint?: string
  repositoryIDs: string[]
  changesetID?: string
  profile: AutonomyProfile
  learningLenses: LearningLens[]
  phase: AutonomyPhase
  revision: number
  userRequest: string
  lockedScope?: LockedScope
  activeGateID?: string
  evidenceManifestID?: string
  budgets: AutonomyBudgets
  counters: AutonomyCounters
  stopReason?: AutonomyStopReason
  createdAt: number
  updatedAt: number
}

export const AutonomyRunTable = sqliteTable(
  "autonomy_run",
  {
    id: text().primaryKey(),
    session_id: text().notNull(),
    project_id: text().notNull(),
    workspace_fingerprint: text(),
    repository_ids: text({ mode: "json" }).$type<string[]>().notNull(),
    changeset_id: text(),
    profile: text().$type<AutonomyProfile>().notNull(),
    learning_lenses: text({ mode: "json" }).$type<LearningLens[]>().notNull(),
    phase: text().$type<AutonomyPhase>().notNull(),
    revision: integer().notNull(),
    user_request: text().notNull(),
    locked_scope: text({ mode: "json" }).$type<LockedScope>(),
    active_gate_id: text(),
    evidence_manifest_id: text(),
    budgets: text({ mode: "json" }).$type<AutonomyBudgets>().notNull(),
    counters: text({ mode: "json" }).$type<AutonomyCounters>().notNull(),
    stop_reason: text().$type<AutonomyStopReason>(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [
    index("autonomy_run_session_idx").on(table.session_id, table.time_updated),
    index("autonomy_run_project_idx").on(table.project_id, table.time_updated),
    index("autonomy_run_phase_idx").on(table.phase),
  ],
)

export const AutonomyGateTable = sqliteTable(
  "autonomy_gate",
  {
    id: text().primaryKey(),
    run_id: text().notNull(),
    kind: text().notNull(),
    revision: integer().notNull(),
    proposal_hash: text().notNull(),
    question_request_id: text().notNull(),
    question_index: integer().notNull(),
    status: text().notNull(),
    detail: text({ mode: "json" }).$type<Record<string, unknown>>(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [index("autonomy_gate_run_idx").on(table.run_id, table.time_updated)],
)

export const AutonomyRunAuditTable = sqliteTable(
  "autonomy_run_audit",
  {
    id: text().primaryKey(),
    run_id: text().notNull(),
    project_id: text().notNull(),
    type: text().notNull(),
    detail: text({ mode: "json" }).$type<Record<string, unknown>>(),
    time_created: integer().notNull(),
  },
  (table) => [
    index("autonomy_run_audit_run_idx").on(table.run_id, table.time_created),
  ],
)

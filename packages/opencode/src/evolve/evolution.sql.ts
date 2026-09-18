/**
 * Durable Evolution records for Continuous Self-Evolution.
 * Spec: docs/evolve/completion-instructions.md §3.3 / §7.2
 */
import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core"

export type EvolutionKind = "soft" | "hard-brief"

export type EvolutionStatus =
  | "observed"
  | "candidate"
  | "planned"
  | "generated"
  | "validating"
  | "accepted"
  | "rejected"
  | "rolled_back"
  | "inconclusive"

export type EvolutionConsent = {
  version: number
  rawTrajectoryOptIn: boolean
  autoDream: boolean
  autoDistill: boolean
  autoSoftGenerate: boolean
  autoHardBrief: boolean
  recordedAt: number
}

export type EvaluationSnapshot = {
  windowStartMs: number
  windowEndMs: number
  sampleSize: number
  metrics?: Record<string, number>
}

export type EvaluationResult = {
  verdict: "pass" | "fail" | "inconclusive"
  notes: string[]
  before?: EvaluationSnapshot
  after?: EvaluationSnapshot
}

export type EvolutionRecord = {
  id: string
  kind: EvolutionKind
  status: EvolutionStatus
  projectID: string
  sessionID?: string
  workspaceFingerprint?: string
  repositoryIDs: string[]
  evidenceIDs: string[]
  artifactIDs: string[]
  consent?: EvolutionConsent
  baseline?: EvaluationSnapshot
  result?: EvaluationResult
  title?: string
  routing?: {
    classification: string
    confidence: number
    reason: string
    alternatives?: string[]
  }
  briefPath?: string
  briefContentHash?: string
  createdAt: number
  updatedAt: number
}

export type EvolutionAuditEvent = {
  id: string
  evolutionID: string
  projectID: string
  type: string
  detail?: Record<string, unknown>
  createdAt: number
}

export const EvolutionTable = sqliteTable(
  "evolution",
  {
    id: text().primaryKey(),
    project_id: text().notNull(),
    session_id: text(),
    kind: text().$type<EvolutionKind>().notNull(),
    status: text().$type<EvolutionStatus>().notNull(),
    workspace_fingerprint: text(),
    repository_ids: text({ mode: "json" }).$type<string[]>().notNull(),
    evidence_ids: text({ mode: "json" }).$type<string[]>().notNull(),
    artifact_ids: text({ mode: "json" }).$type<string[]>().notNull(),
    consent: text({ mode: "json" }).$type<EvolutionConsent>(),
    baseline: text({ mode: "json" }).$type<EvaluationSnapshot>(),
    result: text({ mode: "json" }).$type<EvaluationResult>(),
    title: text(),
    routing: text({ mode: "json" }).$type<EvolutionRecord["routing"]>(),
    brief_path: text(),
    brief_content_hash: text(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [
    index("evolution_project_updated_idx").on(table.project_id, table.time_updated),
    index("evolution_status_idx").on(table.status),
  ],
)

export const EvolutionAuditTable = sqliteTable(
  "evolution_audit",
  {
    id: text().primaryKey(),
    evolution_id: text().notNull(),
    project_id: text().notNull(),
    type: text().notNull(),
    detail: text({ mode: "json" }).$type<Record<string, unknown>>(),
    time_created: integer().notNull(),
  },
  (table) => [
    index("evolution_audit_evolution_idx").on(table.evolution_id, table.time_created),
    index("evolution_audit_project_idx").on(table.project_id, table.time_created),
  ],
)

export type EvolutionTrackName = "dream" | "distill" | "evolve"

export const EvolutionSchedulerTable = sqliteTable(
  "evolution_scheduler",
  {
    project_id: text().notNull(),
    track: text().$type<EvolutionTrackName>().notNull(),
    last_run_ms: integer(),
    lease_until_ms: integer(),
    lease_owner: text(),
    time_updated: integer().notNull(),
  },
  (table) => [primaryKey({ columns: [table.project_id, table.track] })],
)

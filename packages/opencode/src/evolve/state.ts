/**
 * Evolution state machine + SQLite persistence.
 * Fail closed on illegal transitions. Audit events are append-only.
 */
import { randomBytes } from "crypto"
import { Database, eq, desc } from "@/storage"
import {
  EvolutionTable,
  EvolutionAuditTable,
  type EvolutionRecord,
  type EvolutionStatus,
  type EvolutionKind,
  type EvolutionConsent,
  type EvaluationSnapshot,
  type EvaluationResult,
} from "./evolution.sql"

const ALLOWED: Record<EvolutionStatus, EvolutionStatus[]> = {
  observed: ["candidate", "rejected", "inconclusive"],
  candidate: ["planned", "rejected", "inconclusive"],
  planned: ["generated", "rejected", "inconclusive"],
  generated: ["validating", "rejected", "inconclusive"],
  validating: ["accepted", "rejected", "rolled_back", "inconclusive"],
  accepted: ["rolled_back"],
  rejected: [],
  rolled_back: [],
  inconclusive: ["candidate", "rejected"],
}

export function newEvolutionID() {
  return `evo_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`
}

function newAuditID() {
  return `eaud_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`
}

function rowToRecord(row: typeof EvolutionTable.$inferSelect): EvolutionRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    projectID: row.project_id,
    sessionID: row.session_id ?? undefined,
    workspaceFingerprint: row.workspace_fingerprint ?? undefined,
    repositoryIDs: row.repository_ids,
    evidenceIDs: row.evidence_ids,
    artifactIDs: row.artifact_ids,
    consent: row.consent ?? undefined,
    baseline: row.baseline ?? undefined,
    result: row.result ?? undefined,
    title: row.title ?? undefined,
    routing: row.routing ?? undefined,
    briefPath: row.brief_path ?? undefined,
    briefContentHash: row.brief_content_hash ?? undefined,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  }
}

export function createEvolution(input: {
  projectID: string
  kind: EvolutionKind
  sessionID?: string
  workspaceFingerprint?: string
  repositoryIDs?: string[]
  evidenceIDs?: string[]
  title?: string
  consent?: EvolutionConsent
  status?: EvolutionStatus
}): EvolutionRecord {
  const now = Date.now()
  const id = newEvolutionID()
  const status = input.status ?? "observed"
  Database.Client()
    .insert(EvolutionTable)
    .values({
      id,
      project_id: input.projectID,
      session_id: input.sessionID,
      kind: input.kind,
      status,
      workspace_fingerprint: input.workspaceFingerprint,
      repository_ids: input.repositoryIDs ?? [],
      evidence_ids: input.evidenceIDs ?? [],
      artifact_ids: [],
      consent: input.consent,
      title: input.title,
      time_created: now,
      time_updated: now,
    })
    .run()
  appendAudit({
    evolutionID: id,
    projectID: input.projectID,
    type: "created",
    detail: { kind: input.kind, status },
  })
  return getEvolution(id)!
}

export function getEvolution(id: string): EvolutionRecord | undefined {
  const row = Database.Client().select().from(EvolutionTable).where(eq(EvolutionTable.id, id)).get()
  if (!row) return
  return rowToRecord(row)
}

export function listEvolutions(projectID: string, limit = 50): EvolutionRecord[] {
  return Database.Client()
    .select()
    .from(EvolutionTable)
    .where(eq(EvolutionTable.project_id, projectID))
    .orderBy(desc(EvolutionTable.time_updated))
    .limit(limit)
    .all()
    .map(rowToRecord)
}

export function transition(input: {
  id: string
  to: EvolutionStatus
  result?: EvaluationResult
  baseline?: EvaluationSnapshot
  routing?: EvolutionRecord["routing"]
  artifactIDs?: string[]
  evidenceIDs?: string[]
  briefPath?: string
  briefContentHash?: string
}): EvolutionRecord {
  const current = getEvolution(input.id)
  if (!current) throw new Error(`evolution not found: ${input.id}`)
  const allowed = ALLOWED[current.status] ?? []
  if (!allowed.includes(input.to)) {
    throw new Error(`illegal evolution transition ${current.status} → ${input.to}`)
  }
  const now = Date.now()
  Database.Client()
    .update(EvolutionTable)
    .set({
      status: input.to,
      result: input.result ?? current.result,
      baseline: input.baseline ?? current.baseline,
      routing: input.routing ?? current.routing,
      artifact_ids: input.artifactIDs ?? current.artifactIDs,
      evidence_ids: input.evidenceIDs ?? current.evidenceIDs,
      brief_path: input.briefPath ?? current.briefPath,
      brief_content_hash: input.briefContentHash ?? current.briefContentHash,
      time_updated: now,
    })
    .where(eq(EvolutionTable.id, input.id))
    .run()
  appendAudit({
    evolutionID: input.id,
    projectID: current.projectID,
    type: "transition",
    detail: { from: current.status, to: input.to },
  })
  return getEvolution(input.id)!
}

export function appendAudit(input: {
  evolutionID: string
  projectID: string
  type: string
  detail?: Record<string, unknown>
}) {
  Database.Client()
    .insert(EvolutionAuditTable)
    .values({
      id: newAuditID(),
      evolution_id: input.evolutionID,
      project_id: input.projectID,
      type: input.type,
      detail: input.detail,
      time_created: Date.now(),
    })
    .run()
}

export function listAudit(evolutionID: string) {
  return Database.Client()
    .select()
    .from(EvolutionAuditTable)
    .where(eq(EvolutionAuditTable.evolution_id, evolutionID))
    .orderBy(desc(EvolutionAuditTable.time_created))
    .all()
    .map((row) => ({
      id: row.id,
      evolutionID: row.evolution_id,
      projectID: row.project_id,
      type: row.type,
      detail: row.detail ?? undefined,
      createdAt: row.time_created,
    }))
}

/** Reject overlapping before/after evaluation windows (blocker #8). */
export function assertNonOverlappingWindows(before: EvaluationSnapshot, after: EvaluationSnapshot) {
  if (before.windowEndMs > after.windowStartMs) {
    return {
      ok: false as const,
      message: `evaluation windows overlap: before ends ${before.windowEndMs} after starts ${after.windowStartMs}`,
    }
  }
  if (before.windowStartMs >= before.windowEndMs || after.windowStartMs >= after.windowEndMs) {
    return { ok: false as const, message: "evaluation window start must be < end" }
  }
  return { ok: true as const }
}

export function assertNotSuccessStatus(status: EvolutionStatus) {
  if (status === "accepted") return { ok: false as const, message: "accepted requires explicit gate pass" }
  return { ok: true as const }
}

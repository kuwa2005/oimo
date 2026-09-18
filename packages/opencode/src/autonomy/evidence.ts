/**
 * Evidence Manifest + deterministic Judge inputs (FDE/SE §13).
 */
import { createHash, randomBytes } from "crypto"
import { Database, eq, desc } from "@/storage"
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import type { LockedScope } from "./autonomy.sql"
import { freshPassingAttempts, listTestAttempts, type TestAttemptRecord } from "./test-attempt"

export type AcceptanceStatus = "met" | "not_met" | "blocked" | "not_applicable"

export type AutonomyEvidenceManifest = {
  id: string
  runID: string
  lockedScopeHash: string
  changedRepositories: string[]
  changedFiles: string[]
  acceptance: Array<{
    criterion: string
    evidenceIDs: string[]
    status: AcceptanceStatus
  }>
  testAttemptIDs: string[]
  securityChecks: string[]
  unresolved: string[]
  generatedAt: number
}

export type JudgeVerdict =
  | { status: "complete" }
  | { status: "rework"; next: "execute" | "verify"; reasons: string[] }
  | { status: "judge_unavailable"; reason: string }
  | { status: "blocked"; reasons: string[] }

export const AutonomyEvidenceManifestTable = sqliteTable(
  "autonomy_evidence_manifest",
  {
    id: text().primaryKey(),
    run_id: text().notNull(),
    locked_scope_hash: text().notNull(),
    payload: text({ mode: "json" }).$type<AutonomyEvidenceManifest>().notNull(),
    time_created: integer().notNull(),
  },
  (table) => [index("autonomy_evidence_manifest_run_idx").on(table.run_id, table.time_created)],
)

function newID() {
  return `aev_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`
}

export function buildManifest(input: {
  runID: string
  lockedScope: LockedScope
  changedRepositories?: string[]
  changedFiles?: string[]
  codeRevision: string
  securityCheckIDs?: string[]
  criterionEvidence?: Record<string, { evidenceIDs: string[]; status: AcceptanceStatus }>
}): AutonomyEvidenceManifest {
  const attempts = freshPassingAttempts({ runID: input.runID, codeRevision: input.codeRevision })
  const all = listTestAttempts(input.runID)
  const unresolved: string[] = []

  if (attempts.length === 0 && all.some((a) => a.status !== "passed")) {
    unresolved.push("no fresh passing TestAttempt for current code revision")
  }

  const acceptance = input.lockedScope.acceptance_criteria.map((criterion) => {
    const override = input.criterionEvidence?.[criterion]
    if (override) return { criterion, evidenceIDs: override.evidenceIDs, status: override.status }
    if (attempts.length > 0) {
      return { criterion, evidenceIDs: attempts.map((a) => a.id), status: "met" as const }
    }
    return { criterion, evidenceIDs: [], status: "not_met" as const }
  })

  for (const row of acceptance) {
    if (row.status === "not_met") unresolved.push(`acceptance not met: ${row.criterion}`)
    if (row.status === "blocked") unresolved.push(`acceptance blocked: ${row.criterion}`)
  }

  const manifest: AutonomyEvidenceManifest = {
    id: newID(),
    runID: input.runID,
    lockedScopeHash: input.lockedScope.hash,
    changedRepositories: input.changedRepositories ?? input.lockedScope.repositories,
    changedFiles: input.changedFiles ?? [],
    acceptance,
    testAttemptIDs: all.map((a) => a.id),
    securityChecks: input.securityCheckIDs ?? [],
    unresolved,
    generatedAt: Date.now(),
  }

  Database.Client()
    .insert(AutonomyEvidenceManifestTable)
    .values({
      id: manifest.id,
      run_id: input.runID,
      locked_scope_hash: input.lockedScope.hash,
      payload: manifest,
      time_created: manifest.generatedAt,
    })
    .run()

  return manifest
}

export function getLatestManifest(runID: string): AutonomyEvidenceManifest | undefined {
  const row = Database.Client()
    .select()
    .from(AutonomyEvidenceManifestTable)
    .where(eq(AutonomyEvidenceManifestTable.run_id, runID))
    .orderBy(desc(AutonomyEvidenceManifestTable.time_created))
    .limit(1)
    .get()
  return row?.payload
}

/**
 * Deterministic judge: never complete on assistant prose alone;
 * never treat unavailable as complete.
 */
export function judgeFromManifest(input: {
  lockedScope: LockedScope
  manifest?: AutonomyEvidenceManifest
  judgeAvailable: boolean
  unavailableReason?: string
}): JudgeVerdict {
  if (!input.judgeAvailable) {
    return {
      status: "judge_unavailable",
      reason: input.unavailableReason ?? "judge unavailable",
    }
  }
  if (!input.manifest) {
    return { status: "rework", next: "verify", reasons: ["missing evidence manifest"] }
  }
  if (input.manifest.lockedScopeHash !== input.lockedScope.hash) {
    return { status: "rework", next: "execute", reasons: ["manifest locked_scope_hash mismatch"] }
  }
  if (input.manifest.unresolved.length > 0) {
    const blocked = input.manifest.acceptance.some((a) => a.status === "blocked")
    if (blocked) return { status: "blocked", reasons: input.manifest.unresolved }
    return { status: "rework", next: "verify", reasons: input.manifest.unresolved }
  }
  const unmet = input.manifest.acceptance.filter((a) => a.status === "not_met")
  if (unmet.length > 0) {
    return {
      status: "rework",
      next: "execute",
      reasons: unmet.map((a) => `not met: ${a.criterion}`),
    }
  }
  return { status: "complete" }
}

export function hashScopeFields(fields: Omit<LockedScope, "hash">): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 32)
}

export type { TestAttemptRecord }

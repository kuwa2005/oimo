/**
 * TestAttempt + failure classification + retry budget (FDE/SE §10.3–10.5).
 */
import { createHash, randomBytes } from "crypto"
import { Database, eq, and, desc } from "@/storage"
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"

export type TestAttemptStatus = "passed" | "failed" | "timed_out" | "cancelled" | "infra_error"

export type FailureClass =
  | "product_failure"
  | "test_failure"
  | "environment_failure"
  | "pre_existing_failure"
  | "unrelated_failure"
  | "flake"
  | "unknown"

export type TestAttemptRecord = {
  id: string
  runID: string
  command: string[]
  cwdRepositoryID?: string
  environmentFingerprint: string
  codeRevision: string
  startedAt: number
  durationMs: number
  exitCode: number | null
  status: TestAttemptStatus
  failureSignature?: string
  failureClass?: FailureClass
  stdoutArtifact?: string
  stderrArtifact?: string
}

export const AutonomyTestAttemptTable = sqliteTable(
  "autonomy_test_attempt",
  {
    id: text().primaryKey(),
    run_id: text().notNull(),
    command: text({ mode: "json" }).$type<string[]>().notNull(),
    cwd_repository_id: text(),
    environment_fingerprint: text().notNull(),
    code_revision: text().notNull(),
    started_at: integer().notNull(),
    duration_ms: integer().notNull(),
    exit_code: integer(),
    status: text().$type<TestAttemptStatus>().notNull(),
    failure_signature: text(),
    failure_class: text().$type<FailureClass>(),
    stdout_artifact: text(),
    stderr_artifact: text(),
  },
  (table) => [
    index("autonomy_test_attempt_run_idx").on(table.run_id, table.started_at),
    index("autonomy_test_attempt_sig_idx").on(table.run_id, table.failure_signature),
  ],
)

function newID() {
  return `ata_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`
}

export function failureSignature(input: {
  command: string[]
  exitCode: number | null
  stderrTail?: string
}): string {
  const raw = `${input.command.join("\0")}|${input.exitCode ?? "null"}|${(input.stderrTail ?? "").slice(-500)}`
  return createHash("sha256").update(raw).digest("hex").slice(0, 24)
}

export function classifyFailure(input: {
  status: TestAttemptStatus
  stderr?: string
  matchedBaseline?: boolean
  outOfScope?: boolean
  flakeCandidate?: boolean
}): FailureClass {
  if (input.status === "infra_error" || input.status === "timed_out") return "environment_failure"
  if (input.status === "cancelled") return "unknown"
  if (input.status === "passed") return "unknown"
  if (input.matchedBaseline) return "pre_existing_failure"
  if (input.outOfScope) return "unrelated_failure"
  if (input.flakeCandidate) return "flake"
  const err = (input.stderr ?? "").toLowerCase()
  if (/econnrefused|enotfound|permission denied|enoent|network/.test(err)) return "environment_failure"
  if (/expect|assertion|snapshot/.test(err)) return "test_failure"
  if (/error|fail|panic|exception/.test(err)) return "product_failure"
  return "unknown"
}

export function recordTestAttempt(input: Omit<TestAttemptRecord, "id"> & { id?: string }): TestAttemptRecord {
  const id = input.id ?? newID()
  Database.Client()
    .insert(AutonomyTestAttemptTable)
    .values({
      id,
      run_id: input.runID,
      command: input.command,
      cwd_repository_id: input.cwdRepositoryID,
      environment_fingerprint: input.environmentFingerprint,
      code_revision: input.codeRevision,
      started_at: input.startedAt,
      duration_ms: input.durationMs,
      exit_code: input.exitCode,
      status: input.status,
      failure_signature: input.failureSignature,
      failure_class: input.failureClass,
      stdout_artifact: input.stdoutArtifact,
      stderr_artifact: input.stderrArtifact,
    })
    .run()
  return { ...input, id }
}

export function listTestAttempts(runID: string): TestAttemptRecord[] {
  return Database.Client()
    .select()
    .from(AutonomyTestAttemptTable)
    .where(eq(AutonomyTestAttemptTable.run_id, runID))
    .orderBy(desc(AutonomyTestAttemptTable.started_at))
    .all()
    .map((row) => ({
      id: row.id,
      runID: row.run_id,
      command: row.command,
      cwdRepositoryID: row.cwd_repository_id ?? undefined,
      environmentFingerprint: row.environment_fingerprint,
      codeRevision: row.code_revision,
      startedAt: row.started_at,
      durationMs: row.duration_ms,
      exitCode: row.exit_code ?? null,
      status: row.status,
      failureSignature: row.failure_signature ?? undefined,
      failureClass: row.failure_class ?? undefined,
      stdoutArtifact: row.stdout_artifact ?? undefined,
      stderrArtifact: row.stderr_artifact ?? undefined,
    }))
}

export type RetryDecision =
  | { allow: true; reason: string }
  | { allow: false; reason: string; stop?: "repeated_failure" }

/**
 * Same revision + command + failure signature: at most maxAttemptsPerSignature retries.
 * Requires an explicit change record before another attempt when budget exhausted for that signature.
 */
export function decideRetry(input: {
  runID: string
  command: string[]
  codeRevision: string
  environmentFingerprint: string
  failureSignature: string
  maxAttemptsPerSignature: number
  changedSinceLast?: boolean
}): RetryDecision {
  const prior = Database.Client()
    .select()
    .from(AutonomyTestAttemptTable)
    .where(
      and(
        eq(AutonomyTestAttemptTable.run_id, input.runID),
        eq(AutonomyTestAttemptTable.failure_signature, input.failureSignature),
        eq(AutonomyTestAttemptTable.code_revision, input.codeRevision),
        eq(AutonomyTestAttemptTable.environment_fingerprint, input.environmentFingerprint),
      ),
    )
    .all()

  if (prior.length === 0) return { allow: true, reason: "first attempt for signature" }
  if (prior.length >= input.maxAttemptsPerSignature && !input.changedSinceLast) {
    return {
      allow: false,
      reason: `signature ${input.failureSignature} already attempted ${prior.length} times without change`,
      stop: "repeated_failure",
    }
  }
  if (!input.changedSinceLast && prior.length >= 1) {
    return {
      allow: false,
      reason: "identical revision/env/signature — change code, fixture, or environment before retry",
      stop: "repeated_failure",
    }
  }
  return { allow: true, reason: "change recorded since last attempt" }
}

/** Stale pass: a prior pass on an older revision must not satisfy current code. */
export function freshPassingAttempts(input: {
  runID: string
  codeRevision: string
}): TestAttemptRecord[] {
  return listTestAttempts(input.runID).filter(
    (a) => a.status === "passed" && a.codeRevision === input.codeRevision,
  )
}

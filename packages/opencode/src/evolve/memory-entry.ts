/**
 * Memory entry provenance schema for dream (complete-spec §8.1).
 */
import { redactSecrets } from "./evidence"

export type MemoryScope = "repository" | "workspace" | "project" | "user"

export type MemoryEntryStatus = "active" | "disputed" | "stale" | "archived"

export type MemoryEntry = {
  id: string
  statement: string
  scope: MemoryScope
  evidenceIDs: string[]
  confidence: number
  observedAt: number
  verifiedAt?: number
  freshnessDays?: number
  expiresAt?: number
  conflictsWith?: string[]
  status: MemoryEntryStatus
  repositoryID?: string
  workspaceFingerprint?: string
}

export type MemoryValidation = { ok: true; entry: MemoryEntry } | { ok: false; errors: string[] }

const VOLATILE =
  /\b(HEAD|detached|WIP|tmp\/|\/tmp\/|currently assigned|今の担当|今日の|branch tip)\b/i

export function validateMemoryEntry(raw: Partial<MemoryEntry>): MemoryValidation {
  const errors: string[] = []
  if (!raw.statement?.trim()) errors.push("statement required")
  if (!raw.scope || !["repository", "workspace", "project", "user"].includes(raw.scope)) {
    errors.push("scope must be repository|workspace|project|user")
  }
  if (!Array.isArray(raw.evidenceIDs) || raw.evidenceIDs.length === 0) {
    errors.push("at least one evidence ID required (no speculation-as-fact)")
  }
  if (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) {
    errors.push("confidence must be 0..1")
  }
  if (raw.statement && VOLATILE.test(raw.statement)) {
    errors.push("statement looks like volatile/temporary fact; refuse durable memory")
  }
  if (raw.scope === "repository" && !raw.repositoryID) {
    errors.push("repository scope requires repositoryID")
  }
  const secret = redactSecrets(raw.statement ?? "")
  if (secret.redacted) {
    errors.push(`statement contains secrets: ${secret.hits.join(",")}`)
  }
  if (errors.length) return { ok: false, errors }

  const observedAt = raw.observedAt ?? Date.now()
  const freshnessDays = raw.freshnessDays ?? 90
  return {
    ok: true,
    entry: {
      id: raw.id ?? `mem_${observedAt.toString(36)}`,
      statement: secret.text,
      scope: raw.scope!,
      evidenceIDs: raw.evidenceIDs!,
      confidence: raw.confidence!,
      observedAt,
      verifiedAt: raw.verifiedAt,
      freshnessDays,
      expiresAt: raw.expiresAt ?? observedAt + freshnessDays * 86400000,
      conflictsWith: raw.conflictsWith ?? [],
      status: raw.status ?? "active",
      repositoryID: raw.repositoryID,
      workspaceFingerprint: raw.workspaceFingerprint,
    },
  }
}

/** Mark existing entry disputed when a new statement conflicts. */
export function mergeOrDispute(
  existing: MemoryEntry,
  incoming: MemoryEntry,
): { action: "merge" | "dispute"; entry: MemoryEntry } {
  if (existing.statement.trim().toLowerCase() === incoming.statement.trim().toLowerCase()) {
    return {
      action: "merge",
      entry: {
        ...existing,
        evidenceIDs: [...new Set([...existing.evidenceIDs, ...incoming.evidenceIDs])],
        confidence: Math.max(existing.confidence, incoming.confidence),
        verifiedAt: Math.max(existing.verifiedAt ?? 0, incoming.verifiedAt ?? incoming.observedAt),
        status: "active",
      },
    }
  }
  return {
    action: "dispute",
    entry: {
      ...existing,
      status: "disputed",
      conflictsWith: [...new Set([...(existing.conflictsWith ?? []), incoming.id])],
    },
  }
}

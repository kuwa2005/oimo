/** Cross-repository change tracking (oimo-internal; not a Git commit). */

import { Database, eq } from "@/storage"
import type { ApprovalFingerprint } from "./repo-workspace.sql"
import { RepoWorkspaceStateTable } from "./repo-workspace.sql"

export type ChangeSetStatus = "planned" | "approved" | "complete" | "partial" | "failed" | "cancelled"

/** Customer edits vs self-evolution / memory must never share one Change set. */
export type ChangeSetKind = "customer" | "evolve" | "memory"

export type ChangeSetFile = {
  repositoryId: string
  relativePath: string
  action: "create" | "modify" | "delete"
}

export type ChangeSetRepoResult = {
  repositoryId: string
  files: ChangeSetFile[]
  verification?: VerificationSummary
  error?: string
}

export type VerificationSummary = {
  commands: Array<{
    name: string
    command: string
    cwd: string
    status: "passed" | "failed" | "skipped" | "not_run"
    reason?: string
    exitCode?: number
  }>
}

export type CrossRepoPlan = {
  id: string
  title: string
  createdAt: string
  mustChange: Array<{ repositoryId: string; summary: string }>
  reviewOnly: Array<{ repositoryId: string; summary: string }>
  executionOrder: string[]
  graphFingerprint?: string
  approvedAt?: string
  approvedBy?: "user" | "auto"
}

export type ChangeSet = {
  id: string
  sessionID: string
  status: ChangeSetStatus
  kind: ChangeSetKind
  plan: CrossRepoPlan
  executionScope: string[]
  repos: ChangeSetRepoResult[]
  createdAt: string
  updatedAt: string
  approvalFingerprint?: ApprovalFingerprint
  workspaceFingerprint?: string
}

/** Durable key so evolve/memory Change sets do not overwrite customer state. */
export function storageKey(sessionID: string, kind: ChangeSetKind = "customer") {
  return kind === "customer" ? sessionID : `${sessionID}::${kind}`
}

export function inferKindFromPath(absolutePath: string): ChangeSetKind {
  const norm = absolutePath.replace(/\\/g, "/")
  if (norm.includes("/.oimo/evolve/") || /\/\.oimo\/evolve(\/|$)/.test(norm)) {
    return "evolve"
  }
  if (norm.includes("/data/memory/") || norm.includes("/.oimo/memory/")) {
    return "memory"
  }
  return "customer"
}

export function assertKindAllowsPath(cs: ChangeSet, absolutePath: string) {
  const inferred = inferKindFromPath(absolutePath)
  if (cs.kind === inferred) return { ok: true as const }
  return {
    ok: false as const,
    message: `Change set kind "${cs.kind}" cannot record path for kind "${inferred}" (${absolutePath})`,
  }
}

const ALLOWED: Record<ChangeSetStatus, ChangeSetStatus[]> = {
  planned: ["approved", "cancelled"],
  approved: ["complete", "partial", "failed", "cancelled"],
  complete: [],
  partial: ["approved", "cancelled"],
  failed: ["approved", "cancelled"],
  cancelled: [],
}

export function createPlan(input: {
  title: string
  mustChange: CrossRepoPlan["mustChange"]
  reviewOnly: CrossRepoPlan["reviewOnly"]
  executionOrder: string[]
  graphFingerprint?: string
}): CrossRepoPlan {
  return {
    id: `plan-${Date.now()}`,
    title: input.title,
    createdAt: new Date().toISOString(),
    mustChange: input.mustChange,
    reviewOnly: input.reviewOnly,
    executionOrder: input.executionOrder,
    graphFingerprint: input.graphFingerprint,
  }
}

export function createChangeSet(input: {
  sessionID: string
  plan: CrossRepoPlan
  executionScope: string[]
  workspaceFingerprint?: string
  approvalFingerprint?: ApprovalFingerprint
  kind?: ChangeSetKind
}): ChangeSet {
  const now = new Date().toISOString()
  return {
    id: `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionID: input.sessionID,
    status: input.plan.approvedAt ? "approved" : "planned",
    kind: input.kind ?? "customer",
    plan: input.plan,
    executionScope: [...input.executionScope],
    repos: input.executionScope.map((repositoryId) => ({ repositoryId, files: [] })),
    createdAt: now,
    updatedAt: now,
    workspaceFingerprint: input.workspaceFingerprint,
    approvalFingerprint: input.approvalFingerprint,
  }
}

export function approvePlan(plan: CrossRepoPlan, by: "user" | "auto"): CrossRepoPlan {
  return { ...plan, approvedAt: new Date().toISOString(), approvedBy: by }
}

export function recordFileChange(cs: ChangeSet, file: ChangeSetFile): ChangeSet {
  const repos = cs.repos.map((r) => {
    if (r.repositoryId !== file.repositoryId) return r
    const files = [...r.files.filter((f) => f.relativePath !== file.relativePath), file]
    return { ...r, files }
  })
  const hasRepo = repos.some((r) => r.repositoryId === file.repositoryId)
  return {
    ...cs,
    repos: hasRepo ? repos : [...repos, { repositoryId: file.repositoryId, files: [file] }],
    updatedAt: new Date().toISOString(),
  }
}

export function transitionStatus(
  cs: ChangeSet,
  status: ChangeSetStatus,
): ChangeSet {
  const allowed = ALLOWED[cs.status]
  if (!allowed.includes(status)) {
    throw new Error(`Invalid change set transition ${cs.status} → ${status}`)
  }
  return { ...cs, status, updatedAt: new Date().toISOString() }
}

export function finalizeChangeSet(
  cs: ChangeSet,
  status: Extract<ChangeSetStatus, "complete" | "partial" | "failed" | "cancelled">,
): ChangeSet {
  return transitionStatus(cs, status)
}

export function formatPlan(plan: CrossRepoPlan): string {
  return [
    `Cross-repository change plan: ${plan.title}`,
    `id: ${plan.id}`,
    plan.approvedAt ? `approved: ${plan.approvedAt} (${plan.approvedBy})` : "approved: (pending)",
    "",
    "変更対象",
    ...plan.mustChange.map((m) => `- ${m.repositoryId}: ${m.summary}`),
    "",
    "確認のみ",
    ...(plan.reviewOnly.length
      ? plan.reviewOnly.map((m) => `- ${m.repositoryId}: ${m.summary}`)
      : ["- (none)"]),
    "",
    "実行順序",
    ...plan.executionOrder.map((id, i) => `${i + 1}. ${id}`),
  ].join("\n")
}

export function formatChangeSet(cs: ChangeSet): string {
  const lines = [
    `Change set ${cs.id}  status=${cs.status}`,
    `scope: ${cs.executionScope.join(", ")}`,
    "",
  ]
  for (const r of cs.repos) {
    lines.push(`## ${r.repositoryId}`)
    if (!r.files.length) lines.push("- (no files yet)")
    for (const f of r.files) lines.push(`- ${f.action} ${f.relativePath}`)
    if (r.verification) {
      for (const c of r.verification.commands) {
        lines.push(`  verify ${c.name}: ${c.status}${c.reason ? ` (${c.reason})` : ""}`)
      }
    }
    if (r.error) lines.push(`  error: ${r.error}`)
  }
  return lines.join("\n")
}

/** In-memory cache; SQLite is the durable store. Keyed by storageKey(session, kind). */
const bySession = new Map<string, ChangeSet>()

function normalize(cs: ChangeSet): ChangeSet {
  return { ...cs, kind: cs.kind ?? "customer" }
}

function persist(cs: ChangeSet) {
  const key = storageKey(cs.sessionID, cs.kind ?? "customer")
  const value = normalize(cs)
  bySession.set(key, value)
  try {
    const now = Date.now()
    Database.transaction((db) => {
      const existing = db
        .select()
        .from(RepoWorkspaceStateTable)
        .where(eq(RepoWorkspaceStateTable.session_id, key as never))
        .get()
      const row = {
        session_id: key as never,
        workspace_fingerprint: value.workspaceFingerprint ?? "",
        execution_scope: value.executionScope,
        change_set: value,
        approval_fingerprint: value.approvalFingerprint,
        time_created: existing?.time_created ?? now,
        time_updated: now,
      }
      if (existing) {
        db.update(RepoWorkspaceStateTable)
          .set({
            workspace_fingerprint: row.workspace_fingerprint,
            execution_scope: row.execution_scope,
            change_set: row.change_set,
            approval_fingerprint: row.approval_fingerprint,
            time_updated: row.time_updated,
          })
          .where(eq(RepoWorkspaceStateTable.session_id, key as never))
          .run()
        return
      }
      db.insert(RepoWorkspaceStateTable).values(row).run()
    })
  } catch {
    // Unit tests / pre-migration environments keep the in-memory cache only.
  }
  return value
}

export function saveChangeSet(cs: ChangeSet) {
  return persist(cs)
}

export function loadChangeSet(sessionID: string, kind: ChangeSetKind = "customer") {
  const key = storageKey(sessionID, kind)
  const cached = bySession.get(key)
  if (cached) return normalize(cached)
  try {
    const row = Database.use((db) =>
      db.select().from(RepoWorkspaceStateTable).where(eq(RepoWorkspaceStateTable.session_id, key as never)).get(),
    )
    if (row?.change_set) {
      const value = normalize(row.change_set)
      bySession.set(key, value)
      return value
    }
  } catch {
    // ignore
  }
  return
}

export function clearChangeSets() {
  bySession.clear()
}

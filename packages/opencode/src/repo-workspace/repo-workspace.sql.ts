import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import type { SessionID } from "../session/schema"
import type { ChangeSet } from "./change-set"

export type GoalBinding = {
  condition: string
  phase: string
  workspaceFingerprint?: string
  changeSetID?: string
  executionScope?: string[]
  evidenceManifestPath?: string
  startedAt: number
  stopReason?: string
}

export type ApprovalFingerprint = {
  workspaceFingerprint: string
  configPath: string
  graphFingerprint?: string
  repos: Record<
    string,
    {
      head?: string
      branch?: string
      dirty: boolean
      dirtyHash?: string
      /** Porcelain paths at approval time — used to ignore oimo Change set files later. */
      dirtyFiles?: string[]
    }
  >
}

/** Persisted cross-repo change set + execution scope (one row per session). */
export const RepoWorkspaceStateTable = sqliteTable(
  "repo_workspace_state",
  {
    session_id: text().$type<SessionID>().primaryKey(),
    workspace_fingerprint: text().notNull(),
    execution_scope: text({ mode: "json" }).$type<string[]>().notNull(),
    change_set: text({ mode: "json" }).$type<ChangeSet>(),
    approval_fingerprint: text({ mode: "json" }).$type<ApprovalFingerprint>(),
    goal_binding: text({ mode: "json" }).$type<GoalBinding>(),
    time_created: integer().notNull(),
    time_updated: integer().notNull(),
  },
  (table) => [index("repo_workspace_state_updated_idx").on(table.time_updated)],
)

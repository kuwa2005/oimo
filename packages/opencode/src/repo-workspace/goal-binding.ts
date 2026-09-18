/** Persist Goal ↔ Workspace / Change set / scope binding for multi-repo resume. */

import { Database, eq } from "@/storage"
import { RepoWorkspaceStateTable, type GoalBinding } from "./repo-workspace.sql"

export type { GoalBinding }

export async function persistGoalBinding(
  sessionID: string,
  goal: {
    condition: string
    phase: string
    workspaceFingerprint?: string
    changeSetID?: string
    executionScope?: string[]
    evidenceManifestPath?: string
    startedAt: number
    stopReason?: string
  },
) {
  const binding: GoalBinding = {
    condition: goal.condition,
    phase: goal.phase,
    workspaceFingerprint: goal.workspaceFingerprint,
    changeSetID: goal.changeSetID,
    executionScope: goal.executionScope,
    evidenceManifestPath: goal.evidenceManifestPath,
    startedAt: goal.startedAt,
    stopReason: goal.stopReason,
  }
  try {
    const now = Date.now()
    Database.transaction((db) => {
      const existing = db
        .select()
        .from(RepoWorkspaceStateTable)
        .where(eq(RepoWorkspaceStateTable.session_id, sessionID as never))
        .get()
      if (existing) {
        db.update(RepoWorkspaceStateTable)
          .set({
            goal_binding: binding,
            time_updated: now,
          })
          .where(eq(RepoWorkspaceStateTable.session_id, sessionID as never))
          .run()
        return
      }
      db.insert(RepoWorkspaceStateTable)
        .values({
          session_id: sessionID as never,
          workspace_fingerprint: goal.workspaceFingerprint ?? "",
          execution_scope: goal.executionScope ?? [],
          change_set: null,
          approval_fingerprint: null,
          goal_binding: binding,
          time_created: now,
          time_updated: now,
        })
        .run()
    })
  } catch {
    // migration may not yet include goal_binding
  }
}

export function loadGoalBinding(sessionID: string): GoalBinding | undefined {
  try {
    const row = Database.use((db) =>
      db.select().from(RepoWorkspaceStateTable).where(eq(RepoWorkspaceStateTable.session_id, sessionID as never)).get(),
    )
    return row?.goal_binding ?? undefined
  } catch {
    return
  }
}

/**
 * Resume is only safe when Goal, Change set, and scope share the same fingerprint.
 * Missing any one while others exist → block auto-execute.
 */
export function assertBoundTriad(input: {
  workspaceFingerprint?: string
  changeSetID?: string
  executionScope?: string[]
  liveFingerprint?: string
}): { ok: true } | { ok: false; code: string; message: string } {
  // Only enforce the Goal↔Change set↔scope triad when a Goal binding exists.
  // Change set / scope alone (CLI plan approve without /goal) may restore.
  if (!input.workspaceFingerprint) return { ok: true }
  if (!input.changeSetID || !input.executionScope?.length) {
    return {
      ok: false,
      code: "incomplete_binding",
      message:
        "Goal, Change set, and execution scope must restore together; incomplete multi-repo binding blocks execute.",
    }
  }
  if (input.liveFingerprint && input.workspaceFingerprint !== input.liveFingerprint) {
    return {
      ok: false,
      code: "fingerprint_mismatch",
      message: "Workspace fingerprint changed; re-plan before continuing Goal execute phase.",
    }
  }
  return { ok: true }
}

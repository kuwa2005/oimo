/** Per-session execution scope for multi-repo writes. */

import { Database, eq } from "@/storage"
import { RepoWorkspaceStateTable } from "./repo-workspace.sql"
import * as ChangeSet from "./change-set"

const scopes = new Map<string, Set<string>>()

export function setScope(sessionID: string, repositoryIds: string[]) {
  const next = new Set(repositoryIds)
  scopes.set(sessionID, next)
  try {
    const now = Date.now()
    const cs = ChangeSet.loadChangeSet(sessionID)
    Database.transaction((db) => {
      const existing = db
        .select()
        .from(RepoWorkspaceStateTable)
        .where(eq(RepoWorkspaceStateTable.session_id, sessionID as never))
        .get()
      if (existing) {
        db.update(RepoWorkspaceStateTable)
          .set({
            execution_scope: repositoryIds,
            change_set: cs,
            time_updated: now,
          })
          .where(eq(RepoWorkspaceStateTable.session_id, sessionID as never))
          .run()
        return
      }
      db.insert(RepoWorkspaceStateTable)
        .values({
          session_id: sessionID as never,
          workspace_fingerprint: cs?.workspaceFingerprint ?? "",
          execution_scope: repositoryIds,
          change_set: cs,
          approval_fingerprint: cs?.approvalFingerprint,
          time_created: now,
          time_updated: now,
        })
        .run()
    })
  } catch {
    // memory-only fallback
  }
}

export function clearScope(sessionID: string) {
  scopes.delete(sessionID)
}

export function getScope(sessionID: string): Set<string> | undefined {
  const cached = scopes.get(sessionID)
  if (cached) return cached
  try {
    const row = Database.use((db) =>
      db.select().from(RepoWorkspaceStateTable).where(eq(RepoWorkspaceStateTable.session_id, sessionID as never)).get(),
    )
    if (row?.execution_scope?.length) {
      const set = new Set(row.execution_scope)
      scopes.set(sessionID, set)
      return set
    }
  } catch {
    // ignore
  }
  return
}

export function clearAllScopes() {
  scopes.clear()
}

import { locate } from "./resolve"
import * as ChangeSet from "./change-set"
import * as Runtime from "./runtime"
import type { Info } from "./schema"

/** Record a successful file mutation into the session Change set when a workspace is active. */
export async function recordMutation(input: {
  sessionID: string
  absolutePath: string
  action: "create" | "modify" | "delete"
  info?: Info
}) {
  const info = input.info ?? (await Runtime.current())
  if (!info) return
  const hit = locate(info, input.absolutePath)
  if (!hit) return
  const kind = ChangeSet.inferKindFromPath(input.absolutePath)
  const cs = ChangeSet.loadChangeSet(input.sessionID, kind)
  if (!cs) return
  const allowed = ChangeSet.assertKindAllowsPath(cs, input.absolutePath)
  if (!allowed.ok) return
  ChangeSet.saveChangeSet(
    ChangeSet.recordFileChange(cs, {
      repositoryId: hit.repository.id,
      relativePath: hit.location.relativePath,
      action: input.action,
    }),
  )
}

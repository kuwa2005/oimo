/**
 * Project-scoped scheduler / lease for dream|distill|evolve auto-runs.
 * Spec: docs/evolve/completion-instructions.md §12
 */
import { randomBytes } from "crypto"
import { Database, eq, and } from "@/storage"
import { EvolutionSchedulerTable } from "./evolution.sql"

export type EvolutionTrack = "dream" | "distill" | "evolve"

export function getSchedulerRow(projectID: string, track: EvolutionTrack) {
  return Database.Client()
    .select()
    .from(EvolutionSchedulerTable)
    .where(
      and(eq(EvolutionSchedulerTable.project_id, projectID), eq(EvolutionSchedulerTable.track, track)),
    )
    .get()
}

export function recordRun(projectID: string, track: EvolutionTrack, at = Date.now()) {
  const existing = getSchedulerRow(projectID, track)
  if (existing) {
    Database.Client()
      .update(EvolutionSchedulerTable)
      .set({
        last_run_ms: at,
        lease_until_ms: null,
        lease_owner: null,
        time_updated: at,
      })
      .where(
        and(eq(EvolutionSchedulerTable.project_id, projectID), eq(EvolutionSchedulerTable.track, track)),
      )
      .run()
    return
  }
  Database.Client()
    .insert(EvolutionSchedulerTable)
    .values({
      project_id: projectID,
      track,
      last_run_ms: at,
      lease_until_ms: null,
      lease_owner: null,
      time_updated: at,
    })
    .run()
}

/** Try to acquire a lease. Returns owner token if acquired. */
export function tryAcquireLease(input: {
  projectID: string
  track: EvolutionTrack
  ttlMs?: number
  now?: number
}): { ok: true; owner: string } | { ok: false; reason: string } {
  const now = input.now ?? Date.now()
  const ttl = input.ttlMs ?? 15 * 60 * 1000
  const owner = `lease_${randomBytes(4).toString("hex")}`
  const row = getSchedulerRow(input.projectID, input.track)
  if (row?.lease_until_ms && row.lease_until_ms > now) {
    return { ok: false, reason: `lease held until ${row.lease_until_ms}` }
  }
  if (row) {
    Database.Client()
      .update(EvolutionSchedulerTable)
      .set({
        lease_until_ms: now + ttl,
        lease_owner: owner,
        time_updated: now,
      })
      .where(
        and(
          eq(EvolutionSchedulerTable.project_id, input.projectID),
          eq(EvolutionSchedulerTable.track, input.track),
        ),
      )
      .run()
  } else {
    Database.Client()
      .insert(EvolutionSchedulerTable)
      .values({
        project_id: input.projectID,
        track: input.track,
        last_run_ms: null,
        lease_until_ms: now + ttl,
        lease_owner: owner,
        time_updated: now,
      })
      .run()
  }
  return { ok: true, owner }
}

export function releaseLease(projectID: string, track: EvolutionTrack, owner: string) {
  const row = getSchedulerRow(projectID, track)
  if (!row || row.lease_owner !== owner) return false
  Database.Client()
    .update(EvolutionSchedulerTable)
    .set({ lease_until_ms: null, lease_owner: null, time_updated: Date.now() })
    .where(
      and(eq(EvolutionSchedulerTable.project_id, projectID), eq(EvolutionSchedulerTable.track, track)),
    )
    .run()
  return true
}

/** Recover expired leases (crash). */
export function reclaimExpiredLeases(now = Date.now()) {
  const rows = Database.Client().select().from(EvolutionSchedulerTable).all()
  let n = 0
  for (const row of rows) {
    if (row.lease_until_ms != null && row.lease_until_ms <= now) {
      Database.Client()
        .update(EvolutionSchedulerTable)
        .set({ lease_until_ms: null, lease_owner: null, time_updated: now })
        .where(
          and(
            eq(EvolutionSchedulerTable.project_id, row.project_id),
            eq(EvolutionSchedulerTable.track, row.track),
          ),
        )
        .run()
      n++
    }
  }
  return n
}

export function isDue(input: {
  projectID: string
  track: EvolutionTrack
  intervalMs: number
  now?: number
}): { due: boolean; lastRunMs?: number; reason?: string } {
  const now = input.now ?? Date.now()
  reclaimExpiredLeases(now)
  const row = getSchedulerRow(input.projectID, input.track)
  if (row?.lease_until_ms && row.lease_until_ms > now) {
    return { due: false, lastRunMs: row.last_run_ms ?? undefined, reason: "lease_held" }
  }
  if (row?.last_run_ms != null && now - row.last_run_ms < input.intervalMs) {
    return { due: false, lastRunMs: row.last_run_ms, reason: "cooldown" }
  }
  return { due: true, lastRunMs: row?.last_run_ms ?? undefined }
}

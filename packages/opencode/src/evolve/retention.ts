/**
 * Retention / pause / delete / consent for evolution artifacts (complete-spec §6.2).
 */
import path from "path"
import fs from "fs/promises"
import { evolveRoot } from "./store"
import type { EvolutionConsent } from "./evolution.sql"

const ARTIFACT_DIRS = ["briefs", "friction", "reviews", "history", "snapshots", "scenarios"] as const

export async function purgeExpiredArtifacts(input: {
  projectID: string
  retentionDays: number
  nowMs?: number
}): Promise<{ removed: string[]; kept: number }> {
  if (input.retentionDays <= 0) return { removed: [], kept: 0 }
  const now = input.nowMs ?? Date.now()
  const cutoff = now - input.retentionDays * 86400000
  const root = evolveRoot(input.projectID)
  const removed: string[] = []
  let kept = 0

  for (const dir of ARTIFACT_DIRS) {
    const abs = path.join(root, dir)
    let entries: string[] = []
    try {
      entries = await fs.readdir(abs)
    } catch {
      continue
    }
    for (const name of entries) {
      const file = path.join(abs, name)
      const st = await fs.stat(file).catch(() => undefined)
      if (!st) continue
      if (st.mtimeMs < cutoff) {
        await fs.rm(file, { recursive: true, force: true })
        removed.push(path.relative(root, file))
      } else {
        kept++
      }
    }
  }
  return { removed, kept }
}

/** Delete all on-disk evolve artifacts for a project (user-requested wipe). */
export async function deleteProjectEvolution(projectID: string): Promise<{ ok: true; root: string }> {
  const root = evolveRoot(projectID)
  await fs.rm(root, { recursive: true, force: true })
  return { ok: true, root }
}

export function consentPath(projectID: string) {
  return path.join(evolveRoot(projectID), "consent.json")
}

export async function recordConsent(
  projectID: string,
  consent: Omit<EvolutionConsent, "recordedAt"> & { recordedAt?: number },
): Promise<EvolutionConsent> {
  const full: EvolutionConsent = {
    ...consent,
    recordedAt: consent.recordedAt ?? Date.now(),
  }
  const file = consentPath(projectID)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(full, null, 2), "utf8")
  return full
}

export async function loadConsent(projectID: string): Promise<EvolutionConsent | undefined> {
  const file = consentPath(projectID)
  if (!(await Bun.file(file).exists())) return undefined
  return (await Bun.file(file).json()) as EvolutionConsent
}

/** Auto analysis of raw trajectory requires explicit opt-in consent. */
export function assertRawTrajectoryConsent(consent: EvolutionConsent | undefined, mode: "manual" | "automatic") {
  if (mode === "manual") return { ok: true as const }
  if (!consent?.rawTrajectoryOptIn) {
    return {
      ok: false as const,
      message: "automatic raw-trajectory analysis requires consent.rawTrajectoryOptIn=true",
    }
  }
  return { ok: true as const }
}

/** Pause auto-evolution: treat as hard stop when memory.disable_write or evolution.paused. */
export function isEvolutionPaused(cfg: {
  memory?: { disable_write?: boolean }
  evolution?: { paused?: boolean }
}) {
  if (cfg.memory?.disable_write === true) return true
  if (cfg.evolution?.paused === true) return true
  return false
}

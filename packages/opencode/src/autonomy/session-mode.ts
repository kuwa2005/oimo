/**
 * Session-scoped `/auto` (FDE/SE §7.3).
 * Default path mutates only the session's AutonomyRun — not process.env or global oimo.json.
 */
import * as AutonomyRun from "./run"
import { resolveAutonomyRequest, legacyModeFromProfile, type AutonomyRequest } from "./resolve"
import type { AutonomyRunRecord } from "./autonomy.sql"
import type { Mode } from "@/config/autonomy"

export type ApplyScope = "session" | "default"

export type ApplySessionModeInput = {
  mode: Mode
  scope: ApplyScope
  sessionID?: string
  projectID: string
  userRequest?: string
}

export type ApplySessionModeResult = {
  request: AutonomyRequest
  run?: AutonomyRunRecord
  /** se↔fde cleared prior lock; caller must re-lock */
  reLockRequired: boolean
  /** global config should be persisted (only for scope=default) */
  persistGlobal: boolean
}

function requestFromMode(mode: Mode, source: "tui" | "config"): AutonomyRequest {
  return resolveAutonomyRequest({ source, configMode: mode }).request
}

/**
 * Apply `/auto` for a session or as a global default.
 * Never mutates process.env.
 */
export function applySessionMode(input: ApplySessionModeInput): ApplySessionModeResult {
  const request = requestFromMode(input.mode, input.scope === "default" ? "config" : "tui")

  if (input.scope === "default") {
    return { request, reLockRequired: false, persistGlobal: true }
  }

  if (!input.sessionID) {
    throw new Error("sessionID required for session-scoped /auto")
  }

  const existing = AutonomyRun.getLatestRunForSession(input.sessionID)
  if (!existing || existing.phase === "completed" || existing.phase === "cancelled") {
    if (request.profile === "off") {
      return { request, reLockRequired: false, persistGlobal: false }
    }
    const run = AutonomyRun.createRun({
      sessionID: input.sessionID,
      projectID: input.projectID,
      profile: request.profile,
      learningLenses: request.learningLenses,
      userRequest: input.userRequest ?? "",
    })
    return { request, run, reLockRequired: false, persistGlobal: false }
  }

  const profileChanged = existing.profile !== request.profile
  const seFdeFlip =
    profileChanged &&
    (existing.profile === "se" || existing.profile === "fde") &&
    (request.profile === "se" || request.profile === "fde")

  if (request.profile === "off") {
    const run = AutonomyRun.transition({
      id: existing.id,
      expectedRevision: existing.revision,
      event: { type: "cancel" },
    })
    return { request, run, reLockRequired: false, persistGlobal: false }
  }

  const run = AutonomyRun.updateProfile({
    id: existing.id,
    expectedRevision: existing.revision,
    profile: request.profile,
    learningLenses: request.learningLenses,
    clearLock: seFdeFlip || (profileChanged && Boolean(existing.lockedScope)),
  })

  return {
    request,
    run,
    reLockRequired: seFdeFlip || (profileChanged && Boolean(existing.lockedScope)),
    persistGlobal: false,
  }
}

export function effectiveModeForSession(sessionID: string | undefined, fallbackCfgMode: Mode): Mode {
  if (!sessionID) return fallbackCfgMode
  const run = AutonomyRun.getLatestRunForSession(sessionID)
  if (!run) return fallbackCfgMode
  if (run.phase === "completed" || run.phase === "cancelled") return fallbackCfgMode
  return legacyModeFromProfile(run.profile)
}

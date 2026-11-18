/**
 * Session-scoped `/auto` (FDE/SE §7.3).
 * Default path mutates only the session's AutonomyRun — not process.env or global oimo.json.
 */
import * as AutonomyRun from "./run"
import { resolveAutonomyRequest, legacyModeFromProfile, type AutonomyRequest } from "./resolve"
import type { AutonomyRunRecord } from "./autonomy.sql"
import * as ConfigAutonomy from "@/config/autonomy"
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
      // Remember "off" for this session so it overrides an instance-wide autonomy default.
      const created = AutonomyRun.createRun({
        sessionID: input.sessionID,
        projectID: input.projectID,
        profile: "off",
        learningLenses: [],
        userRequest: input.userRequest ?? "",
      })
      const run = AutonomyRun.transition({
        id: created.id,
        expectedRevision: created.revision,
        event: { type: "cancel" },
      })
      return { request, run, reLockRequired: false, persistGlobal: false }
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
    const cancelled = AutonomyRun.transition({
      id: existing.id,
      expectedRevision: existing.revision,
      event: { type: "cancel" },
    })
    const run = AutonomyRun.updateProfile({
      id: cancelled.id,
      expectedRevision: cancelled.revision,
      profile: "off",
      learningLenses: [],
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

/**
 * The session's latest run decides its mode; a completed run keeps its profile so the next task in the
 * same session stays in that mode. Only runs cancelled before session-scoped "off" existed fall back.
 */
export function effectiveModeForSession(sessionID: string | undefined, fallbackCfgMode: Mode): Mode {
  if (!sessionID) return fallbackCfgMode
  const run = AutonomyRun.getLatestRunForSession(sessionID)
  if (!run) return fallbackCfgMode
  if (run.phase === "cancelled" && run.profile !== "off") return fallbackCfgMode
  return legacyModeFromProfile(run.profile)
}

/**
 * Autonomy config as one session sees it: the session's run overrides the instance config, so a
 * session-scoped `/auto` never leaks into other sessions of the same project.
 */
export function sessionAutonomyConfig<
  T extends { autonomy?: ConfigAutonomy.Info; experimental?: { auto_continue?: boolean } },
>(cfg: T, sessionID: string | undefined): T {
  const base = ConfigAutonomy.mode(cfg)
  const mode = effectiveModeForSession(sessionID, base)
  if (mode === base) return cfg
  return {
    ...cfg,
    autonomy: { ...cfg.autonomy, ...ConfigAutonomy.patchForMode(mode).autonomy },
    experimental: { ...cfg.experimental, auto_continue: false },
  }
}

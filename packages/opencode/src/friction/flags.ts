import type { FrictionMode } from "./types"
import { Flag } from "@/flag/flag"
import { CharacterMode, parseCharacterMode, type CharacterMode as CharMode } from "@/character/mode"
import type { LearningLens } from "@/autonomy/resolve"
import { getLatestRunForSession } from "@/autonomy/run"

/**
 * Prefer AutonomyRun.learningLenses (session-scoped, durable).
 * Env is bootstrap-only fallback for processes that have not created a Run yet.
 */
export function frictionModesFromLenses(lenses: readonly LearningLens[]): FrictionMode[] {
  return [...new Set(lenses.filter((l): l is FrictionMode => l === "se" || l === "fde"))]
}

export function frictionModesForSession(sessionID?: string): FrictionMode[] {
  if (sessionID) {
    const run = getLatestRunForSession(sessionID)
    if (run && run.phase !== "cancelled" && run.phase !== "completed") {
      const fromRun = frictionModesFromLenses(run.learningLenses)
      if (fromRun.length) return fromRun
    }
  }
  return frictionModesFromFlag()
}

function truthyEnv(key: string) {
  const v = process.env[key]
  if (!v) return false
  const n = v.toLowerCase()
  return n !== "0" && n !== "false" && n !== "no"
}

/** @deprecated Prefer frictionModesForSession — env is bootstrap fallback only. */
export function frictionModesFromFlag(): FrictionMode[] {
  const modes: FrictionMode[] = []
  if (truthyEnv("MIMOCODE_FRICTION_SE")) modes.push("se")
  if (truthyEnv("MIMOCODE_FRICTION_FDE")) modes.push("fde")
  if (modes.length) return [...new Set(modes)]
  if (truthyEnv("MIMOCODE_FDE")) return ["fde"]
  if (truthyEnv("MIMOCODE_AUTONOMY") && !truthyEnv("MIMOCODE_SPAUTO") && !truthyEnv("MIMOCODE_AUTOSP")) {
    return ["se"]
  }
  return []
}

export function frictionLearningEnabled(sessionID?: string): boolean {
  return frictionModesForSession(sessionID).length > 0
}

export function characterModeFromFlag(): CharMode {
  try {
    return parseCharacterMode(Flag.MIMOCODE_CHARACTER)
  } catch {
    return CharacterMode.Off
  }
}

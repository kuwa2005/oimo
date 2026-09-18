import type { SessionID } from "./schema"
import type { AutonomyPhase } from "@/autonomy/autonomy.sql"

/** Goal phase is the AutonomyPhase set — no parallel hearing|execute only. */
export type GoalPhase = AutonomyPhase

/** Hearing-like phases: clarify / lock / wait before implementation. */
export function isHearingLike(phase: GoalPhase | undefined): boolean {
  return phase === "discover" || phase === "lock_pending" || phase === "waiting_user"
}

/** Implementation-side phases after lock. */
export function isExecuteLike(phase: GoalPhase | undefined): boolean {
  return phase === "execute" || phase === "verify" || phase === "judge"
}

/** @deprecated Prefer AutonomyPhase names; maps legacy Goal values. */
export function canonicalizeGoalPhase(phase: string): GoalPhase {
  if (phase === "hearing") return "discover"
  if (
    phase === "discover" ||
    phase === "lock_pending" ||
    phase === "execute" ||
    phase === "verify" ||
    phase === "judge" ||
    phase === "waiting_user" ||
    phase === "completed" ||
    phase === "blocked" ||
    phase === "cancelled"
  ) {
    return phase
  }
  return "discover"
}

/**
 * @deprecated Use AutonomyBridge + AutonomyGate. Kept as a no-op shim so stray
 * imports do not crash; does not advance Goal phase.
 */
type SetPhase = (sessionID: SessionID, phase: GoalPhase) => void

export const goalRef = {
  register(_fn: SetPhase) {
    // no-op — Goal registers AutonomyBridge instead
  },
  setPhase(_sessionID: SessionID, _phase: GoalPhase) {
    // no-op
  },
}

/**
 * Cycle-free bridge: Autonomy Gate → Goal phase (replaces process-global goalRef usage
 * from the question tool). Goal.Service registers the handler at layer init.
 */
import type { SessionID } from "@/session/schema"

type LockHandler = (sessionID: SessionID) => void

let lockApproved: LockHandler | undefined

export const AutonomyBridge = {
  registerLockApproved(fn: LockHandler) {
    lockApproved = fn
  },
  notifyLockApproved(sessionID: SessionID) {
    lockApproved?.(sessionID)
  },
}

import { isFreeUsageLimitError, isRetryableTransientError } from "@/session/retry"

function httpStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined
  const bag = error as {
    status?: number | string
    statusCode?: number | string
    response?: { status?: number | string }
    cause?: unknown
  }
  const nested = bag.cause
  const fromNested = nested && nested !== error ? httpStatus(nested) : undefined
  const raw = bag.status ?? bag.statusCode ?? bag.response?.status
  const statusNum = typeof raw === "string" ? Number.parseInt(raw, 10) : raw
  if (typeof statusNum === "number" && !Number.isNaN(statusNum)) return statusNum
  return fromNested
}

/** Model removed, wrong endpoint, or auth-scoped catalog miss — try the next free candidate. */
export function isAutoFreeCandidateUnavailableError(error: unknown): boolean {
  const status = httpStatus(error)
  if (status === 404 || status === 410) return true
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  if (
    msg.includes("not found") ||
    msg.includes("model_not_found") ||
    msg.includes("model not found") ||
    msg.includes("does not exist")
  ) {
    return true
  }
  const nested = (error as { cause?: unknown }).cause
  if (nested && nested !== error && isAutoFreeCandidateUnavailableError(nested)) return true
  return false
}

/** Pre-commit failures that should advance Auto (free) to the next upstream model. */
export function isAutoFreeFailoverAdvanceError(error: unknown): boolean {
  // Per-model Zen quota — try the next free candidate before surfacing Go upsell.
  if (isFreeUsageLimitError(error)) return true
  if (isRetryableTransientError(error)) return true
  if (isAutoFreeCandidateUnavailableError(error)) return true
  return false
}

/**
 * First-frame failover state machine (FCC ProviderExecutor §5.2).
 *
 * Commit = first non-empty protocol frame. After commit, never switch models.
 * Before commit, retryable failures advance to the next candidate.
 */

export type FailoverCandidate<T> = T

export type FailoverDecision =
  | { action: "commit" }
  | { action: "advance"; reason: string }
  | { action: "fail"; reason: string }

export function isCommitStreamEvent(event: { type: string; text?: string }): boolean {
  switch (event.type) {
    case "text-delta":
    case "reasoning-delta":
      return typeof event.text === "string" && event.text.length > 0
    case "tool-input-start":
    case "tool-call":
    case "tool-input-delta":
    case "file":
    case "source":
      return true
    default:
      return false
  }
}

export function classifyFailoverFailure(error: unknown, committed: boolean, hasNext: boolean): FailoverDecision {
  if (committed) return { action: "fail", reason: "committed" }
  if (!hasNext) return { action: "fail", reason: "no-candidates" }
  if (!isAutoFreeFailoverAdvanceError(error)) return { action: "fail", reason: "non-retryable" }
  return {
    action: "advance",
    reason: isAutoFreeCandidateUnavailableError(error) ? "unavailable-pre-commit" : "retryable-pre-commit",
  }
}

/**
 * Pure walk of candidates. `attempt` runs one candidate and returns either
 * success, or throws. Caller supplies commit detection via `onEvent`.
 */
export async function runWithFailover<C, R>(input: {
  candidates: C[]
  attempt: (candidate: C, index: number, signal: { markCommitted: () => void; committed: () => boolean }) => Promise<R>
  onAdvance?: (from: C, to: C, index: number, reason: string) => void
}): Promise<R> {
  if (input.candidates.length === 0) throw new Error("Auto Model (free): no available free model candidates")

  let lastError: unknown
  for (let index = 0; index < input.candidates.length; index++) {
    const candidate = input.candidates[index]!
    let committed = false
    const signal = {
      markCommitted: () => {
        committed = true
      },
      committed: () => committed,
    }
    try {
      return await input.attempt(candidate, index, signal)
    } catch (error) {
      lastError = error
      const next = input.candidates[index + 1]
      const decision = classifyFailoverFailure(error, committed, next !== undefined)
      if (decision.action !== "advance" || !next) throw error
      input.onAdvance?.(candidate, next, index + 1, decision.reason)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

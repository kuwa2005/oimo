import type { NamedError } from "@mimo-ai/shared/util/error"
import { Cause, Clock, Duration, Effect, Schedule } from "effect"
import { MessageV2 } from "./message-v2"
import { iife } from "@/util/iife"
import { httpStatusFromMessage } from "@/util/error"

export type Err = ReturnType<NamedError["toObject"]>

// This exported message is shared with the TUI upsell detector. Matching on a
// literal error string kind of sucks, but it is the simplest for now.
export const GO_UPSELL_MESSAGE = "Free usage exceeded, subscribe to Go https://opencode.ai/go"

/** OpenCode Zen public-pool daily quota (HTTP 429 + FreeUsageLimitError). */
export function isFreeUsageLimitError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const data = (error as { data?: { responseBody?: string; message?: string } }).data
    if (typeof data?.responseBody === "string" && data.responseBody.includes("FreeUsageLimitError")) return true
    if (typeof data?.message === "string" && data.message.includes("FreeUsageLimitError")) return true
  }
  if (error instanceof Error) {
    if (error.message.includes("FreeUsageLimitError")) return true
    const cause = (error as { cause?: unknown }).cause
    if (cause && cause !== error && isFreeUsageLimitError(cause)) return true
  }
  return false
}

// Shared with the TUI: does this retry status message indicate a rate-limit /
// queue ("too many requests" / HTTP 429) condition? retryable() normalizes
// every 429 variant into a message containing one of these substrings.
export function isRateLimitMessage(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes("too many requests") ||
    lower.includes("too_many_requests") ||
    lower.includes("rate limit") ||
    // Providers also spell it with an underscore in structured bodies/types
    // (e.g. "rate_limit_error", "rate_limited"). Prior fix only matched the
    // spaced form, so these slipped through into the raw TUI error. See T18.
    lower.includes("rate_limit") ||
    lower.includes("rate increased too quickly")
  )
}

/** Classify session.error / assistant terminal errors for rate-limit handling. */
export function isRateLimitSessionError(error: unknown, message: string) {
  if (message.includes("Rate limit")) return true
  if (isRateLimitMessage(message)) return true
  if (typeof error !== "object" || error === null || !("name" in error) || error.name !== "APIError") return false
  const data = (error as { data?: { statusCode?: number; responseBody?: string; message?: string } }).data
  if (data?.statusCode === 429) return true
  if (typeof data?.message === "string" && isRateLimitMessage(data.message)) return true
  if (typeof data?.responseBody === "string" && isRateLimitMessage(data.responseBody)) return true
  return false
}

export const RETRY_INITIAL_DELAY = 1000
export const RETRY_BACKOFF_FACTOR = 2
/** @deprecated Prefer RETRY_SOFT_HEADER_CAP_MS — soft rate-limits must not honor day-long headers. */
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000
/**
 * Cap on provider `retry-after` / `retry-after-ms` for soft capacity errors.
 * OpenCode Console free tier often returns hour-scale headers for transient
 * congestion; honoring them made SessionRetry hit maxWaitMs on attempt 1 and
 * stop the main agent even when a manual retry succeeds immediately.
 */
export const RETRY_SOFT_HEADER_CAP_MS = 60_000
export const RETRY_MAX_DELAY = 2_147_483_647 // max 32-bit signed integer for setTimeout
/** If a single wait would exceed this, SessionRetry stops so Auto Model can switch candidates. */
export const RETRY_MODEL_SWITCH_MS = 5 * 60 * 1000

const NETWORK_ERROR_CODES = new Set(["ECONNRESET", "EPIPE", "ETIMEDOUT"])
const SSE_TIMEOUT_MESSAGE = "SSE read timed out"
const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504, 529])

function isTransientOverloadMessage(message: string): boolean {
  const lower = message.toLowerCase()
  return (
    lower.includes("temporarily overloaded") ||
    lower.includes("service temporarily unavailable") ||
    lower.includes("provider is overloaded") ||
    (lower.includes("upstream error") &&
      (lower.includes("overloaded") || lower.includes("unavailable") || lower.includes("temporarily")))
  )
}

function retryableHttpStatus(status: number | undefined) {
  return status !== undefined && RETRYABLE_HTTP_STATUS.has(status)
}

function messageSignalsTransient(message: string) {
  if (isRateLimitMessage(message)) return true
  if (retryableHttpStatus(httpStatusFromMessage(message))) return true
  if (isTransientOverloadMessage(message)) return true
  return false
}

/**
 * Single source of truth for "is this transient and retryable?".
 *
 * Used by:
 * - `retryable()` below (processor-level Effect.retry policy via SessionRetry.policy)
 * - `isTransientCapacityError()` in llm.ts (LLM-internal retry around streamText)
 *
 * Both call sites previously had divergent logic — this hung sessions on
 * SSE timeouts that one path retried but the other dropped. See Spec ③.
 */
export function isRetryableTransientError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: { statusCode?: number } }).data
    if (retryableHttpStatus(data?.statusCode)) return true
  }

  if (!(error instanceof Error)) return false

  // AI SDK wraps exhausted internal retries as AI_RetryError / RetryError.
  // Auto Model (free) failover uses THIS helper — without unwrapping, a Console
  // "Rate limit exceeded" after 3 SDK attempts never advances to the next
  // free candidate and the turn dies on big-pickle alone.
  const bag = error as { lastError?: unknown; errors?: unknown[]; cause?: unknown }
  const nested =
    bag.lastError ?? (Array.isArray(bag.errors) ? bag.errors[bag.errors.length - 1] : undefined) ?? bag.cause
  if (nested && nested !== error && isRetryableTransientError(nested)) return true

  if (messageSignalsTransient(error.message)) return true

  const status =
    (error as { status?: number | string }).status ??
    (error as { statusCode?: number | string }).statusCode ??
    (error as { response?: { status?: number | string } }).response?.status
  // Some providers surface the HTTP status as a numeric string (e.g. "429")
  // rather than a number — coerce before matching so the 429 path is not missed.
  const statusNum = typeof status === "string" ? Number.parseInt(status, 10) : status
  if (retryableHttpStatus(typeof statusNum === "number" && !Number.isNaN(statusNum) ? statusNum : undefined))
    return true

  const code = (error as { code?: string }).code
  if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) return true

  if (error.message === SSE_TIMEOUT_MESSAGE) return true

  return false
}

function cap(ms: number) {
  return Math.min(ms, RETRY_MAX_DELAY)
}

export function delay(attempt: number, error?: MessageV2.APIError) {
  const exponential = cap(RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1))
  if (error) {
    const headers = error.data.responseHeaders
    if (headers) {
      const retryAfterMs = headers["retry-after-ms"]
      if (retryAfterMs) {
        const parsedMs = Number.parseFloat(retryAfterMs)
        if (!Number.isNaN(parsedMs)) {
          return Math.min(cap(parsedMs), RETRY_SOFT_HEADER_CAP_MS)
        }
      }

      const retryAfter = headers["retry-after"]
      if (retryAfter) {
        const parsedSeconds = Number.parseFloat(retryAfter)
        if (!Number.isNaN(parsedSeconds)) {
          return Math.min(cap(Math.ceil(parsedSeconds * 1000)), RETRY_SOFT_HEADER_CAP_MS)
        }
        // Try parsing as HTTP date format
        const parsed = Date.parse(retryAfter) - Date.now()
        if (!Number.isNaN(parsed) && parsed > 0) {
          return Math.min(cap(Math.ceil(parsed)), RETRY_SOFT_HEADER_CAP_MS)
        }
      }

      return exponential
    }
  }

  // OpenCode-style exponential: 1s, 2s, 4s, 8s, 16s, ... (no soft-cap).
  // SessionRetry.policy stops when a single wait would exceed RETRY_MODEL_SWITCH_MS
  // (5 minutes) so the TUI can show the recover dialog instead of hanging forever.
  return exponential
}

export function retryable(error: Err) {
  // context overflow errors should not be retried
  if (MessageV2.ContextOverflowError.isInstance(error)) return undefined

  if (MessageV2.APIError.isInstance(error)) {
    const status = error.data.statusCode
    // Upstream processing failures (e.g. multimodal data corruption) return 400
    // but are transient — retry them.
    if (status === 400 && error.data.responseBody?.includes("upstream_error")) return error.data.message
    // Free-usage exhaustion is delivered as an HTTP 429 with a
    // `type:FreeUsageLimitError` body that also reads "Rate limit exceeded".
    // It is a TERMINAL, non-retryable condition — the user must subscribe to
    // Go. This MUST be checked before the generic 429-retry branch below,
    // otherwise the 429 branch swallows it into "Too Many Requests" + a
    // day-long retry-after and the upsell prompt is never shown. See PR #1680.
    if (isFreeUsageLimitError(error)) return GO_UPSELL_MESSAGE
    // Subscription (Go) usage exhaustion is also an HTTP 429 but is likewise
    // terminal — the plan's quota is spent, retrying just hangs the session.
    // Exclude it from the generic 429-retry path the same way.
    if (error.data.responseBody?.includes("SubscriptionUsageLimitError")) return undefined
    // 429 rate-limits are transient and retryable EVEN when the provider SDK
    // marked the APIError isRetryable:false (many do, expecting the caller to
    // honor retry-after). Prior fix (T7) only normalized 429s in the retry-status
    // and plaintext/JSON-message branches; a 429 APIError with isRetryable:false
    // fell through the non-retryable bail below (status 429 < 500), was never
    // retried, and surfaced as a raw blob in the TUI terminal error render
    // (errorBody prints error.data.message verbatim). Catch it here — by numeric
    // status OR a rate-limit signal in the message/body — before that bail so it
    // both retries and shows a clean status. See T18.
    if (
      status === 429 ||
      isRateLimitMessage(error.data.message) ||
      (typeof error.data.responseBody === "string" && isRateLimitMessage(error.data.responseBody))
    ) {
      return "Too Many Requests"
    }
    // 5xx errors are transient server failures and should always be retried,
    // even when the provider SDK doesn't explicitly mark them as retryable.
    if (!error.data.isRetryable && !(status !== undefined && status >= 500)) return undefined
    return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
  }

  // Catch raw Error / network / SSE-timeout BEFORE generic Err JSON parsing.
  // SessionRetry.policy unwraps Cause<unknown> via opts.parse, but raw
  // Error instances slip past the APIError check above. See Spec ③ P2.
  if (isRetryableTransientError(error as unknown)) {
    if (error instanceof Error) return error.message || "Transient network error"
    const msg = (error as { data?: { message?: string } }).data?.message
    return msg || "Transient network error"
  }

  const json = iife(() => {
    try {
      if (typeof error.data?.message === "string") {
        const parsed = JSON.parse(error.data.message)
        return parsed
      }

      return JSON.parse(error.data.message)
    } catch {
      return undefined
    }
  })

  // Check for rate limit patterns in plain text error messages. Skip when the
  // message is a JSON object string — returning it here would leak the raw blob
  // into the TUI. Structured bodies are normalized by the JSON branch below.
  const msg = error.data?.message
  if (typeof msg === "string" && (!json || typeof json !== "object")) {
    if (isRateLimitMessage(msg)) {
      return msg
    }
  }
  if (!json || typeof json !== "object") return undefined
  const code = typeof json.code === "string" ? json.code : ""

  // Normalize any 429 / too-many-requests JSON shape into a retryable
  // rate-limit status. Providers disagree on where they put the signal:
  // top-level `type`/`code`, or nested under `error.{type,code,message}`.
  const errorCode = String(json.error?.code ?? "")
  const errorType = typeof json.error?.type === "string" ? json.error.type : ""
  const errorMessage = typeof json.error?.message === "string" ? json.error.message : ""
  const is429 = code === "429" || errorCode === "429" || String(json.status ?? "") === "429"
  if (
    errorType === "too_many_requests" ||
    is429 ||
    isRateLimitMessage(errorMessage) ||
    (typeof json.message === "string" && isRateLimitMessage(json.message))
  ) {
    return "Too Many Requests"
  }
  if (code.includes("exhausted") || code.includes("unavailable")) {
    return "Provider is overloaded"
  }
  if (json.type === "error" && errorCode.includes("rate_limit")) {
    return "Rate Limited"
  }
  return undefined
}

export function policy(opts: {
  parse: (error: unknown) => Err
  set: (input: { attempt: number; message: string; next: number }) => Effect.Effect<void>
  /**
   * When a computed wait exceeds this, stop retrying and let the error
   * propagate (Auto Model uses this to switch free candidates at 5 minutes).
   */
  maxWaitMs?: number
  /** Cap each individual wait (non-auto models keep retrying under this ceiling). */
  capWaitMs?: number
  /** When true, skip session.status upsell on FreeUsageLimit (Auto free tries next Zen model). */
  suppressGoUpsell?: boolean
}) {
  return Schedule.fromStepWithMetadata(
    Effect.succeed((meta: Schedule.InputMetadata<unknown>) => {
      const error = opts.parse(meta.input)
      const message = retryable(error)
      if (!message) return Cause.done(meta.attempt)
      // FreeUsageLimitError is terminal (subscribe to Go). retryable() still
      // returns GO_UPSELL_MESSAGE so the TUI can open the upsell dialog via
      // session.status — publish once, then stop. Retrying would hang the
      // session on a day-long retry-after the same way SubscriptionUsageLimit
      // used to. See PR #1680.
      if (message === GO_UPSELL_MESSAGE) {
        return Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          if (!opts.suppressGoUpsell) yield* opts.set({ attempt: meta.attempt, message, next: now })
          return yield* Cause.done(meta.attempt)
        })
      }
      let wait = delay(meta.attempt, MessageV2.APIError.isInstance(error) ? error : undefined)
      if (opts.maxWaitMs !== undefined && wait > opts.maxWaitMs) {
        // Wait would exceed the model-switch threshold — stop so the caller
        // can failover (or surface a recoverable main-agent stop).
        return Cause.done(meta.attempt)
      }
      if (opts.capWaitMs !== undefined && wait > opts.capWaitMs) {
        wait = opts.capWaitMs
      }
      return Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        yield* opts.set({ attempt: meta.attempt, message, next: now + wait })
        return [meta.attempt, Duration.millis(wait)] as [number, Duration.Duration]
      })
    }),
  )
}

export * as SessionRetry from "./retry"

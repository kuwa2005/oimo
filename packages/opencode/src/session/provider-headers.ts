/**
 * OpenCode Zen (`opencode.ai/zen`) gates the high-throughput free pool
 * (Big Pickle etc.) on request headers matching the official client.
 * `checkHeaders` is a case-insensitive substring match against User-Agent
 * / `x-opencode-client`. Sending `oimo/...` or omitting `x-opencode-*`
 * routes the call into `dailyRequestsFallback`, which exhausts almost
 * immediately. See anomalyco/opencode#28807.
 *
 * Console free tier additionally requires `User-Agent: opencode/<semver>`
 * with semver >= {@link ZEN_COMPAT_VERSION} (HTTP 426 otherwise). oimo's
 * own package version is independent (0.x), so Zen UA reports at least
 * that floor — not the fork version.
 */

import semver from "semver"

/** Minimum OpenCode version Console free tier accepts in User-Agent. */
export const ZEN_COMPAT_VERSION = "1.18.0"

function installationVersion(): string {
  return typeof MIMOCODE_VERSION === "string" ? MIMOCODE_VERSION : "local"
}

/** Version string embedded in Zen `User-Agent` (never below the Console floor). */
export function zenCompatVersion(version = installationVersion()): string {
  if (semver.valid(version) && semver.gte(version, ZEN_COMPAT_VERSION)) return version
  return ZEN_COMPAT_VERSION
}

/** Brand UA for non-Zen providers. */
export function oimoUserAgent(version = installationVersion()): string {
  return `oimo/${version}`
}

/** Official-compatible UA for OpenCode Zen / Console free tier. */
export function zenUserAgent(version = installationVersion()): string {
  return `opencode/${zenCompatVersion(version)}`
}

export const OIMO_USER_AGENT = oimoUserAgent()
export const ZEN_USER_AGENT = zenUserAgent()

export type ProviderHeaderInput = {
  providerID: string
  sessionID?: string
  requestID?: string
  parentSessionID?: string
  projectID?: string
  /** Surface id. Official OpenCode sends `cli` / `desktop` / `app` / `acp`. */
  client?: string
  extra?: Record<string, string | undefined>
}

function compact(headers: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0),
  )
}

/**
 * Outbound HTTP headers for a model call.
 *
 * Matches anomalyco/opencode `session/llm/request.ts` semantics, with fork
 * branding on non-Zen providers:
 *
 * - OpenCode Zen (`providerID` starts with `opencode`): official-compatible
 *   identity headers. Applied *after* `extra` so free-tier UA / x-opencode-*
 *   cannot be wiped by plugins (Console 426 / fallback pool).
 * - Everything else: oimo defaults first, then `extra` (model / plugin
 *   headers) win — same merge order as upstream, so Codex etc. can set
 *   `User-Agent: opencode/...` and `originator`.
 */
export function providerRequestHeaders(input: ProviderHeaderInput): Record<string, string> {
  const extra = compact(input.extra ?? {})
  const client = input.client ?? process.env["MIMOCODE_CLIENT"] ?? "cli"
  const version = installationVersion()

  if (input.providerID.startsWith("opencode")) {
    return {
      ...extra,
      ...compact({
        ...(input.projectID ? { "x-opencode-project": input.projectID } : {}),
        ...(input.sessionID ? { "x-opencode-session": input.sessionID } : {}),
        ...(input.requestID ? { "x-opencode-request": input.requestID } : {}),
        ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
        "x-opencode-client": client,
        "User-Agent": zenUserAgent(version),
      }),
    }
  }

  return {
    ...compact({
      ...(input.sessionID ? { "x-session-affinity": input.sessionID } : {}),
      ...(input.sessionID ? { "X-Session-Id": input.sessionID } : {}),
      ...(input.parentSessionID ? { "x-parent-session-id": input.parentSessionID } : {}),
      "User-Agent": oimoUserAgent(version),
    }),
    ...extra,
  }
}

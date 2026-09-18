import type { FrictionMetrics } from "./metrics"
import type { ScenarioScore } from "./scenario"
import { assertNonOverlappingWindows } from "./state"
import type { EvaluationSnapshot } from "./evolution.sql"

export type EvalVerdict = "pass" | "fail" | "inconclusive"

export type ReplayComparison = {
  before: Partial<FrictionMetrics>
  after: Partial<FrictionMetrics>
  verdict: EvalVerdict
  notes: string[]
  sampleSize?: { before: number; after: number }
  normalized?: boolean
}

export type GateResult = {
  verdict: EvalVerdict
  friction?: ReplayComparison
  scenarios?: ScenarioScore[]
  notes: string[]
}

function rate(n: number, denom: number) {
  if (denom <= 0) return n
  return n / denom
}

function round(n: number) {
  return Number.isInteger(n) ? n : Math.round(n * 1000) / 1000
}

/**
 * Compare friction using per-session / per-user-turn rates when possible.
 * Absolute count drops from lower usage alone must not count as improvement.
 */
export function compareFriction(before: FrictionMetrics, after: FrictionMetrics): ReplayComparison {
  const notes: string[] = []
  let improved = 0
  let worsened = 0

  const beforeDenom = Math.max(before.sessions, before.userTurns, 1)
  const afterDenom = Math.max(after.sessions, after.userTurns, 1)
  const normalized = before.sessions > 0 && after.sessions > 0

  if (before.sessions >= 3 && after.sessions > 0 && after.sessions < before.sessions * 0.25) {
    return {
      before,
      after,
      verdict: "inconclusive",
      notes: [
        `sample size collapsed (${before.sessions} → ${after.sessions} sessions); do not treat usage drop as improvement`,
      ],
      sampleSize: { before: before.sessions, after: after.sessions },
      normalized,
    }
  }

  const pairs: Array<[string, number, number, boolean]> = normalized
    ? [
        ["toolCalls/session", rate(before.toolCalls, before.sessions), rate(after.toolCalls, after.sessions), true],
        [
          "correctionHints/userTurn",
          rate(before.correctionHints, Math.max(before.userTurns, 1)),
          rate(after.correctionHints, Math.max(after.userTurns, 1)),
          true,
        ],
        ["hacScore", before.humanAttentionCost.score, after.humanAttentionCost.score, true],
        [
          "assistant/user turn ratio",
          rate(before.assistantTurns, Math.max(before.userTurns, 1)),
          rate(after.assistantTurns, Math.max(after.userTurns, 1)),
          true,
        ],
      ]
    : [
        ["toolCalls", before.toolCalls, after.toolCalls, true],
        ["correctionHints", before.correctionHints, after.correctionHints, true],
        ["hacScore", before.humanAttentionCost.score, after.humanAttentionCost.score, true],
        ["userTurns", before.userTurns, after.userTurns, true],
      ]

  for (const [label, a, b, lowerBetter] of pairs) {
    if (a === 0 && b === 0) continue
    const delta = b - a
    if (Math.abs(delta) < 1e-9) {
      notes.push(`${label}: unchanged (${round(a)})`)
      continue
    }
    const better = lowerBetter ? delta < 0 : delta > 0
    if (better) {
      improved++
      notes.push(`${label}: ${round(a)} → ${round(b)} (improved)`)
      continue
    }
    worsened++
    notes.push(`${label}: ${round(a)} → ${round(b)} (worsened)`)
  }

  const verdict: EvalVerdict =
    improved > 0 && worsened === 0 ? "pass" : worsened > improved ? "fail" : "inconclusive"

  return {
    before,
    after,
    verdict,
    notes,
    sampleSize: { before: beforeDenom, after: afterDenom },
    normalized,
  }
}

/** Require non-overlapping windows before comparing. */
export function compareFrictionWindows(input: {
  before: FrictionMetrics
  after: FrictionMetrics
  beforeWindow: EvaluationSnapshot
  afterWindow: EvaluationSnapshot
}): ReplayComparison {
  const windows = assertNonOverlappingWindows(input.beforeWindow, input.afterWindow)
  if (!windows.ok) {
    return {
      before: input.before,
      after: input.after,
      verdict: "inconclusive",
      notes: [windows.message],
      normalized: false,
    }
  }
  const cmp = compareFriction(input.before, input.after)
  cmp.notes.unshift(
    `windows ok: [${input.beforeWindow.windowStartMs},${input.beforeWindow.windowEndMs}) → [${input.afterWindow.windowStartMs},${input.afterWindow.windowEndMs})`,
  )
  return cmp
}

export function formatEval(c: ReplayComparison): string {
  return [
    `# Evaluation gate: ${c.verdict}`,
    c.normalized ? "(normalized per session / user-turn)" : "(absolute counts)",
    c.sampleSize ? `sample: before=${c.sampleSize.before} after=${c.sampleSize.after}` : "",
    "",
    ...c.notes.map((n) => `- ${n}`),
    "",
    c.verdict === "pass"
      ? "Adopt candidate."
      : c.verdict === "fail"
        ? "Reject or rollback candidate."
        : "Needs more evidence / human judgment.",
  ]
    .filter(Boolean)
    .join("\n")
}

/** Combine friction compare + scenario fixture scores into one gate. */
export function combineGate(input: {
  friction?: ReplayComparison
  scenarios?: ScenarioScore[]
}): GateResult {
  const notes: string[] = []
  const scenarioFail = (input.scenarios ?? []).filter((s) => !s.pass)

  if (input.friction) notes.push(...input.friction.notes.map((n) => `friction: ${n}`))
  if (input.scenarios) {
    const pass = input.scenarios.filter((s) => s.pass).length
    notes.push(`scenarios: ${pass}/${input.scenarios.length} passed`)
    for (const s of scenarioFail) {
      notes.push(`scenario FAIL ${s.id}: ${s.failures.join("; ")}`)
    }
  }

  if (scenarioFail.length > 0) {
    return { verdict: "fail", friction: input.friction, scenarios: input.scenarios, notes }
  }
  if (input.friction?.verdict === "fail") {
    return { verdict: "fail", friction: input.friction, scenarios: input.scenarios, notes }
  }
  if (input.friction?.verdict === "pass") {
    return { verdict: "pass", friction: input.friction, scenarios: input.scenarios, notes }
  }
  if (input.scenarios?.length && scenarioFail.length === 0) {
    return { verdict: "pass", friction: input.friction, scenarios: input.scenarios, notes }
  }
  return { verdict: "inconclusive", friction: input.friction, scenarios: input.scenarios, notes }
}

export function formatGate(g: GateResult): string {
  return [
    `# Combined gate: ${g.verdict}`,
    "",
    ...g.notes.map((n) => `- ${n}`),
    "",
    g.verdict === "pass"
      ? "Safe to propose Human approval for adopt."
      : g.verdict === "fail"
        ? "Do not auto-apply; revise or rollback."
        : "Need human judgment or more scenario runs.",
  ].join("\n")
}

import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export const Persona = Schema.Literals(["se", "fde"]).annotate({
  description: "Autonomy persona when hearing_first is on: se (Requirements Lock) or fde (Solution Lock + PoC).",
})
export type Persona = Schema.Schema.Type<typeof Persona>

export const Info = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean).annotate({
    description:
      "AI-driven autonomous mode: hear requirements first (when hearing_first), then auto-approve safe permissions and continue until an independent judge confirms documentary completion or a budget limit is reached.",
  }),
  hearing_first: Schema.optional(Schema.Boolean).annotate({
    description:
      "When true (default), start in a hearing phase: ask the user clarifying questions and lock requirements before enabling never-ask / non-stop execution.",
  }),
  persona: Schema.optional(Persona).annotate({
    description:
      "When hearing_first is true: se (default, Requirements Lock) or fde (Forward Deployed Engineer, Solution Lock, PoC allowed before lock).",
  }),
  docs_evidence: Schema.optional(Schema.Boolean).annotate({
    description:
      "When true (default), the stop-condition requires documentary evidence (hearing log, requirements/specs including test criteria, verification) before the judge may allow stop.",
  }),
  max_turns: Schema.optional(Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))).annotate({
    description: "Maximum judge-driven re-entries per task (default 50).",
  }),
  max_duration_ms: Schema.optional(Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))).annotate({
    description: "Wall-clock budget per task in milliseconds (default 7_200_000 = 2h).",
  }),
  max_cost_usd: Schema.optional(Schema.Number.check(Schema.isGreaterThan(0))).annotate({
    description: "Soft cumulative cost ceiling per task in USD (default 10). Checked before each model call.",
  }),
  judge_max_retries: Schema.optional(Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))).annotate({
    description: "Judge evaluation retries before stopping with judge_failed (default 2).",
  }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>

export const DEFAULT_MAX_TURNS = 50
export const DEFAULT_MAX_DURATION_MS = 7_200_000
export const DEFAULT_MAX_COST_USD = 10
export const DEFAULT_JUDGE_MAX_RETRIES = 2

export type Limits = {
  maxTurns: number
  maxDurationMs: number
  maxCostUsd: number
  judgeMaxRetries: number
}

export function limits(cfg?: Info): Limits {
  return {
    maxTurns: cfg?.max_turns ?? DEFAULT_MAX_TURNS,
    maxDurationMs: cfg?.max_duration_ms ?? DEFAULT_MAX_DURATION_MS,
    maxCostUsd: cfg?.max_cost_usd ?? DEFAULT_MAX_COST_USD,
    judgeMaxRetries: cfg?.judge_max_retries ?? DEFAULT_JUDGE_MAX_RETRIES,
  }
}

/** True when autonomous hands-free mode is active (includes legacy auto_continue). */
export function enabled(cfg: { autonomy?: Info; experimental?: { auto_continue?: boolean } }): boolean {
  if (cfg.autonomy?.enabled === true) return true
  return cfg.experimental?.auto_continue === true
}

/** Runtime / UI auto-mode tiers selectable via `/auto`.
 * Canonical SE is `"se"`. `"normal"` is a deprecated compatibility alias. */
export type Mode = "none" | "se" | "special" | "fde" | "normal"

const MODES: readonly Mode[] = ["none", "se", "special", "fde", "normal"]

export function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value)
}

/** Normalize deprecated `normal` → canonical `se`. */
export function canonicalMode(mode: Mode): Exclude<Mode, "normal"> {
  if (mode === "normal") return "se"
  return mode
}

/** Default SE when hearing_first; fde only when persona is explicitly fde. */
export function persona(cfg?: Info): Persona {
  return cfg?.persona === "fde" ? "fde" : "se"
}

/** Resolve current mode from merged config (after Flag overlays). Returns canonical `se`, never `normal`. */
export function mode(cfg: { autonomy?: Info; experimental?: { auto_continue?: boolean } }): Mode {
  if (!enabled(cfg)) return "none"
  if (!hearingFirst(cfg.autonomy)) return "special"
  if (persona(cfg.autonomy) === "fde") return "fde"
  return "se"
}

/** Config patch written by `/auto` (global oimo.json). */
export function patchForMode(next: Mode): { autonomy: Info } {
  const m = canonicalMode(next)
  if (m === "none") return { autonomy: { enabled: false } }
  if (m === "special") return { autonomy: { enabled: true, hearing_first: false } }
  if (m === "fde") return { autonomy: { enabled: true, hearing_first: true, persona: "fde" } }
  return { autonomy: { enabled: true, hearing_first: true, persona: "se" } }
}

/**
 * @deprecated Do not call from `/auto`. Session-scoped mode must not mutate
 * process.env (FDE/SE §7.2–7.3). Kept for rare bootstrap/migration callers only.
 *
 * Align process env with a mode so Flag.MIMOCODE_* matches after instance
 * dispose/reload (CLI --spauto/--autonomy/--fde must not stick across /auto).
 */
export function applyProcessEnv(next: Mode) {
  const m = canonicalMode(next)
  const clear = (...keys: string[]) => {
    for (const key of keys) delete process.env[key]
  }
  if (m === "none") {
    clear(
      "MIMOCODE_AUTONOMY",
      "MIMOCODE_FDE",
      "MIMOCODE_SPAUTO",
      "MIMOCODE_AUTOSP",
      "MIMOCODE_DANGEROUSLY_SKIP_PERMISSIONS",
      "MIMOCODE_AUTO_APPROVE_DELETE",
      "MIMOCODE_FRICTION_SE",
      "MIMOCODE_FRICTION_FDE",
    )
    return
  }
  process.env.MIMOCODE_AUTONOMY = "1"
  process.env.MIMOCODE_DANGEROUSLY_SKIP_PERMISSIONS = "1"
  if (m === "special") {
    process.env.MIMOCODE_SPAUTO = "1"
    process.env.MIMOCODE_AUTO_APPROVE_DELETE = "1"
    clear("MIMOCODE_FDE", "MIMOCODE_FRICTION_SE", "MIMOCODE_FRICTION_FDE")
    return
  }
  if (m === "fde") {
    process.env.MIMOCODE_FDE = "1"
    process.env.MIMOCODE_FRICTION_FDE = "1"
    clear("MIMOCODE_SPAUTO", "MIMOCODE_AUTOSP", "MIMOCODE_AUTO_APPROVE_DELETE", "MIMOCODE_FRICTION_SE")
    return
  }
  process.env.MIMOCODE_FRICTION_SE = "1"
  clear("MIMOCODE_FDE", "MIMOCODE_SPAUTO", "MIMOCODE_AUTOSP", "MIMOCODE_AUTO_APPROVE_DELETE", "MIMOCODE_FRICTION_FDE")
}

/** Default true: clarify with the user before never-ask execution. */
export function hearingFirst(cfg?: Info): boolean {
  return cfg?.hearing_first !== false
}

/** Default true: documentary evidence is part of the stop condition. */
export function docsEvidence(cfg?: Info): boolean {
  return cfg?.docs_evidence !== false
}

const SE_LOCK_HEADER = /requirements?\s*lock|spec\s*lock|仕様確定|要件ロック|要件確定/i
const FDE_LOCK_HEADER = /solution\s*lock|解決策ロック|ソリューションロック|方針確定/i

/** Headers that mark the autonomy lock gate (SE Requirements Lock or FDE Solution Lock). */
export function isAutonomyLockHeader(header?: string): boolean {
  if (!header) return false
  return SE_LOCK_HEADER.test(header) || FDE_LOCK_HEADER.test(header)
}

/** @deprecated Prefer isAutonomyLockHeader — kept for call-site compatibility. */
export function isRequirementsLockHeader(header?: string): boolean {
  return isAutonomyLockHeader(header)
}

/** Affirmative answers that lock requirements and enter execute phase. */
export function isLockApproval(answers: ReadonlyArray<ReadonlyArray<string> | undefined>): boolean {
  const flat = answers.flatMap((a) => a ?? []).join(" ")
  if (!flat) return false
  return /(approved|looks good|proceed|yes|ok|lgtm|承認|確定|進めて|問題ない)/i.test(flat)
}

export function buildGoalCondition(
  userText: string,
  opts: { docsEvidence: boolean; hearingFirst: boolean; persona?: Persona },
): string {
  const fde = opts.hearingFirst && opts.persona === "fde"
  const lines = [
    fde
      ? "Deliver the user's request as a Forward Deployed Engineer (FDE): understand the field problem, propose Level 1–3 solutions, validate with a PoC when useful, lock the chosen solution with the customer, then implement, verify, and leave measurable improvement evidence — without stopping after Solution Lock."
      : opts.hearingFirst
        ? "Deliver the user's request as an excellent SE would: uncover hidden needs, lock requirements with the customer, leave documentary evidence, then implement and verify without stopping."
        : "Deliver the user's request in Super Auto (special) mode: raise every material doubt, answer it yourself from context, leave documentary evidence, then implement and verify completely non-stop with zero user waits.",
    "",
    "User request:",
    userText,
  ]
  if (fde) {
    lines.push(
      "",
      "Phase A — FDE discovery (before production implementation):",
      "- Problem First: analyze request, background, and true problem. Do not start from technology choice.",
      "- Investigate field: people, workflow, data sources, systems, bottlenecks (handwork, transcription, search, approval waits).",
      "- Ask clarifying questions via the question tool (compose:ask) only when investigation cannot answer them. Prefer structured options.",
      "- Propose at least Level 1 (minimal), Level 2 (workflow), Level 3 (AI/agent) options; prefer the simplest stable high-ROI path. Deterministic First, AI When Needed.",
      "- PoC First: small spikes/scripts to validate hypotheses ARE allowed before lock. Do NOT ship full production features/architecture until Solution Lock.",
      "- When the recommended solution is clear, ask a Solution Lock question (header exactly: `Solution Lock`) with Approved / Changes needed.",
      "- Do NOT ignore the user's explicit request; if you propose an alternative, state both: what they asked for and why another approach may work better.",
    )
  } else if (opts.hearingFirst) {
    lines.push(
      "",
      "Phase A — Hearing (before any implementation code):",
      "- Read between the lines; surface assumptions the customer has not stated.",
      "- Ask clarifying questions via the question tool (compose:ask). Prefer structured options.",
      "- For every question, record in the hearing log: why you asked, background/assumption, and the answer/result.",
      "- When requirements are clear, present a concise design and ask a Requirements Lock question (header exactly: `Requirements Lock`) with Approved / Changes needed.",
      "- Do NOT write implementation code until Requirements Lock is Approved.",
    )
  }
  if (!opts.hearingFirst) {
    lines.push(
      "",
      "Phase A — Super Auto / special (self-hearing; never wait on the user):",
      "- Raise the same questions an SE would ask (hidden needs, platforms, constraints, success criteria).",
      "- Answer them yourself from the repo, docs, and prior user answers in this session. Prefer the question tool for structure, but never-ask is on — you will get [Never-Ask]; choose immediately and continue.",
      "- Do NOT block on a human. Do NOT end a turn waiting for input.",
      "- Record each material decision as self-answered Q&A in the hearing log: why / background / chosen result.",
      "- Skip Requirements Lock with the user; treat recorded assumptions as locked and proceed immediately.",
    )
  }
  if (opts.docsEvidence) {
    if (fde) {
      lines.push(
        "",
        "Documentary evidence — ALL numbered items below are MANDATORY before stop. Judge: verify each item against the transcript individually; if ANY item lacks evidence, the condition is NOT satisfied:",
        "1. Understanding: stated purpose of the engagement",
        "2. Current Problem: true field problem (not only the surface request)",
        "3. Proposed Solution: Level 1–3 options considered and the chosen path with rationale",
        "4. PoC / spike evidence when a PoC was warranted (what was tried and what it proved), or an explicit reason none was needed",
        "5. Implementation covering the locked solution scope",
        "6. Verification: tests EXECUTED (or honest blockers) with commands and results; Before/After metrics when measurable",
        "7. Next Improvement: at most 3 prioritized follow-ups (do not dump a long backlog)",
        "Save under the compose docs dir (`specs/`, `plans/`, `reports/`). A later reader must see how the field problem was solved from the docs alone.",
      )
    } else {
      lines.push(
        "",
        "Documentary evidence — ALL numbered items below are MANDATORY before stop. Judge: verify each item against the transcript individually; if ANY item lacks evidence, the condition is NOT satisfied:",
        "1. Hearing log: every question asked (or self-answered in Super Auto), each with why / background / result",
        "2. Requirements + functional specification covering the delivered scope",
        "3. Test specification written as part of the specs: concrete test cases with inputs and expected results (unit / integration / smoke / e2e as applicable — at minimum unit cases for core logic plus an acceptance checklist)",
        "4. Tests EXECUTED, not merely written: an automated test program was created and run (preferred), or a manual test run is documented case-by-case; actual pass/fail results recorded in a report",
        "5. Verification evidence: commands run and their output (or honest blockers)",
        "Document length may scale with complexity, but no item may be skipped — even a single-file project gets a short test spec and an executed test run, never zero.",
        "Save under the compose docs dir (`specs/`, `plans/`, `reports/`). AI-driven delivery means the trail of decisions is obvious from the docs alone.",
      )
    }
  }
  lines.push(
    "",
    fde
      ? "Phase B — After Solution Lock: implement the chosen solution, write and RUN verification, record results and optional Before/After metrics, propose at most 3 next improvements, and finish non-stop. Do not stop until the field problem is solved with verifiable evidence in the transcript and docs."
      : opts.hearingFirst
        ? "Phase B — After Requirements Lock: implement, then write and RUN the tests defined in the test specification, record results, and finish non-stop. Do not stop until the request is done with verifiable evidence in the transcript and docs."
        : "Phase B — Execute immediately: implement, then write and RUN the tests defined in the test specification, record results, and finish non-stop. Do not stop for user input. Do not stop until the request is done with verifiable evidence in the transcript and docs.",
  )
  return lines.join("\n")
}

/** Pull the original user request out of a goal condition built by `buildGoalCondition`. */
export function extractUserRequest(condition: string): string | undefined {
  const match = condition.match(/User request:\n([\s\S]*?)(?:\n\nPhase [AB]|\n\nDocumentary evidence|$)/)
  const text = match?.[1]?.trim()
  return text || undefined
}

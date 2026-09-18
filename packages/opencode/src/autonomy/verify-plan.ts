/**
 * Verification Planner (FDE/SE §10) — change-kind → minimal sufficient evidence.
 */
export type ChangeKind =
  | "docs_only"
  | "config_schema"
  | "pure_logic"
  | "integration"
  | "tui"
  | "cli_parse"
  | "multi_repo"
  | "security"

export type VerificationStep = {
  id: string
  kind: "link_check" | "format" | "unit" | "typecheck" | "integration" | "pty" | "parser" | "spawn_smoke" | "adversarial"
  command?: string[]
  required: boolean
  reason: string
}

export type VerificationPlan = {
  changeKind: ChangeKind
  steps: VerificationStep[]
  maxTestAttempts: number
  maxAttemptsPerSignature: number
  notes: string[]
}

const DEFAULT_BUDGET = { maxTestAttempts: 20, maxAttemptsPerSignature: 2 }

export function classifyChangeKind(input: {
  paths: string[]
  touchesTests?: boolean
  touchesSchema?: boolean
  touchesTui?: boolean
  touchesCli?: boolean
  multiRepo?: boolean
  securitySensitive?: boolean
}): ChangeKind {
  if (input.securitySensitive) return "security"
  if (input.multiRepo) return "multi_repo"
  if (input.touchesTui) return "tui"
  if (input.touchesCli && !input.touchesTests) return "cli_parse"
  if (input.touchesSchema) return "config_schema"
  if (input.paths.length > 0 && input.paths.every((p) => /\.(md|txt|html)$/i.test(p) || p.startsWith("docs/"))) {
    return "docs_only"
  }
  if (input.touchesTests || input.paths.some((p) => /integration|e2e/i.test(p))) return "integration"
  return "pure_logic"
}

export function planVerification(changeKind: ChangeKind): VerificationPlan {
  if (changeKind === "docs_only") {
    return {
      changeKind,
      maxTestAttempts: 5,
      maxAttemptsPerSignature: 1,
      notes: ["docs-only: no new unit tests required"],
      steps: [
        { id: "format", kind: "format", required: true, reason: "markdown/format sanity" },
        { id: "links", kind: "link_check", required: true, reason: "internal link / index consistency" },
      ],
    }
  }
  if (changeKind === "config_schema") {
    return {
      changeKind,
      ...DEFAULT_BUDGET,
      notes: [],
      steps: [
        {
          id: "parser",
          kind: "unit",
          required: true,
          reason: "parser / migration / invalid input",
          command: ["bun", "test", "test/config"],
        },
        { id: "typecheck", kind: "typecheck", required: true, reason: "schema types", command: ["bun", "typecheck"] },
      ],
    }
  }
  if (changeKind === "cli_parse") {
    return {
      changeKind,
      ...DEFAULT_BUDGET,
      notes: ["prefer pure parseCli tests; spawn only representative smoke"],
      steps: [
        { id: "parser", kind: "parser", required: true, reason: "CLI pure parser" },
        { id: "help_smoke", kind: "spawn_smoke", required: false, reason: "optional --help smoke" },
      ],
    }
  }
  if (changeKind === "tui") {
    return {
      changeKind,
      ...DEFAULT_BUDGET,
      notes: [],
      steps: [
        { id: "reducer", kind: "unit", required: true, reason: "TUI reducer/state unit" },
        { id: "pty", kind: "pty", required: false, reason: "PTY/render when available" },
        { id: "typecheck", kind: "typecheck", required: true, reason: "types", command: ["bun", "typecheck"] },
      ],
    }
  }
  if (changeKind === "integration" || changeKind === "multi_repo") {
    return {
      changeKind,
      ...DEFAULT_BUDGET,
      notes: ["focused → package typecheck → relevant suite; avoid full suite every edit"],
      steps: [
        { id: "focused", kind: "unit", required: true, reason: "focused unit covering change" },
        { id: "typecheck", kind: "typecheck", required: true, reason: "package typecheck", command: ["bun", "typecheck"] },
        { id: "integration", kind: "integration", required: true, reason: "boundary / multi-repo fixture" },
      ],
    }
  }
  if (changeKind === "security") {
    return {
      changeKind,
      ...DEFAULT_BUDGET,
      notes: [],
      steps: [
        { id: "adversarial", kind: "adversarial", required: true, reason: "path/shell/permission adversarial" },
        { id: "unit", kind: "unit", required: true, reason: "policy unit" },
      ],
    }
  }
  // pure_logic
  return {
    changeKind,
    ...DEFAULT_BUDGET,
    notes: [],
    steps: [
      { id: "focused", kind: "unit", required: true, reason: "focused unit" },
      { id: "typecheck", kind: "typecheck", required: true, reason: "typecheck", command: ["bun", "typecheck"] },
    ],
  }
}

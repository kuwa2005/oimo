import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export const Info = Schema.Struct({
  max_autonomous_turns: Schema.optional(Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))).annotate({
    description:
      "After this many assistant turns since the last real user message, pause the loop and wait for user confirmation (default: unset = no limit).",
  }),
  max_autonomous_tool_calls: Schema.optional(Schema.Number.check(Schema.isInt()).check(Schema.isGreaterThan(0))).annotate({
    description:
      "After this many tool calls since the last real user message, pause the loop (default: unset = no limit).",
  }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>

export type Limits = {
  maxAutonomousTurns?: number
  maxAutonomousToolCalls?: number
}

export function limits(cfg: { session_bounds?: Info }): Limits {
  return {
    maxAutonomousTurns: cfg.session_bounds?.max_autonomous_turns,
    maxAutonomousToolCalls: cfg.session_bounds?.max_autonomous_tool_calls,
  }
}

export function enabled(cfg: { session_bounds?: Info }): boolean {
  const l = limits(cfg)
  return l.maxAutonomousTurns != null || l.maxAutonomousToolCalls != null
}

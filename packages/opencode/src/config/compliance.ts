import { Schema } from "effect"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { Flag } from "@/flag/flag"

export const Info = Schema.Struct({
  redact_input: Schema.optional(Schema.Boolean).annotate({
    description:
      "When true, redact high-confidence secrets from user chat input before persist and LLM send. Default false (opt-in). Also enabled by --compliance / MIMOCODE_COMPLIANCE=1.",
  }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type Info = Schema.Schema.Type<typeof Info>

/** True when input secret redaction is active (config or env/CLI flag). */
export function redactInput(cfg?: { compliance?: Info }): boolean {
  if (Flag.MIMOCODE_COMPLIANCE) return true
  return cfg?.compliance?.redact_input === true
}

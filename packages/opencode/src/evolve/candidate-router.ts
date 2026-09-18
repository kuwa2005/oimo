/**
 * Candidate Router — classify improvement candidates (complete-spec §7.4).
 */
import { z } from "zod"

export const CandidateClassification = z.enum([
  "durable_fact",
  "project_procedure",
  "project_runtime_extension",
  "workspace_knowledge",
  "hard_evolution_brief",
  "skip_needs_more_evidence",
  "reject_secret_or_dangerous",
])

export type CandidateClassification = z.infer<typeof CandidateClassification>

export const CandidateDecisionSchema = z.object({
  classification: CandidateClassification,
  confidence: z.number().min(0).max(1),
  reason: z.string().min(8),
  alternatives: z.array(z.string()).optional(),
  targetScope: z.enum(["repository", "workspace", "project", "user", "product"]).optional(),
  repositoryID: z.string().optional(),
})

export type CandidateDecision = z.infer<typeof CandidateDecisionSchema>

export function validateCandidateDecision(raw: unknown): {
  ok: true
  decision: CandidateDecision
} | {
  ok: false
  errors: string[]
} {
  const parsed = CandidateDecisionSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }
  }
  const d = parsed.data
  if (d.classification === "reject_secret_or_dangerous" && d.confidence < 0.5) {
    return { ok: false, errors: ["reject_secret_or_dangerous requires confidence >= 0.5"] }
  }
  if (d.classification === "hard_evolution_brief" && d.targetScope && d.targetScope !== "product") {
    return { ok: false, errors: ["hard_evolution_brief must target product scope"] }
  }
  if (d.targetScope === "repository" && !d.repositoryID) {
    return { ok: false, errors: ["repository scope requires repositoryID"] }
  }
  return { ok: true, decision: d }
}

/** Deterministic routing hints from text (prompt still decides; this validates/guards). */
export function suggestClassification(input: {
  text: string
  evidenceCount: number
  mentionsSecret?: boolean
  isProductCommon?: boolean
}): CandidateClassification {
  if (input.mentionsSecret) return "reject_secret_or_dangerous"
  if (input.evidenceCount < 1) return "skip_needs_more_evidence"
  if (input.isProductCommon) return "hard_evolution_brief"
  if (/\b(hook|workflow|tool|tui)\b/i.test(input.text)) return "project_runtime_extension"
  if (/\b(always|never|convention|手順)\b/i.test(input.text)) return "project_procedure"
  if (/\b(workspace|across repos|横断)\b/i.test(input.text)) return "workspace_knowledge"
  return "durable_fact"
}

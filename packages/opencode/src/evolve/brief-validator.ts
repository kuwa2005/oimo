/**
 * Hard-evolution brief machine validator.
 * Spec: docs/evolve/completion-instructions.md §9.4
 */
import { redactSecrets, assertSafeForArtifact } from "./evidence"

const REQUIRED_HEADINGS = [
  /^##\s*Meta\b/im,
  /^##\s*1[\.\)]\s*.+/im,
  /^##\s*2[\.\)]\s*.+/im,
  /^##\s*3[\.\)]\s*.+/im,
  /^##\s*4[\.\)]\s*.+/im,
  /^##\s*5[\.\)]\s*.+/im,
  /^##\s*6[\.\)]\s*.+/im,
  /^##\s*7[\.\)]\s*.+/im,
  /^##\s*8[\.\)]\s*.+/im,
  /^##\s*9[\.\)]\s*.+/im,
  /^##\s*Security\b|^##\s*Security\s*\/\s*Privacy\b/im,
  /^##\s*Test plan\b/im,
  /^##\s*Rollback plan\b/im,
  /^##\s*Out of scope\b/im,
  /^##\s*Why not soft evolution\b|^##\s*Why not a project skill\b/im,
]

export type BriefValidation = {
  ok: boolean
  errors: string[]
  warnings: string[]
}

export function validateHardBrief(markdown: string): BriefValidation {
  const errors: string[] = []
  const warnings: string[] = []

  if (!markdown.trim()) {
    return { ok: false, errors: ["brief is empty"], warnings }
  }

  for (const re of REQUIRED_HEADINGS) {
    if (!re.test(markdown)) {
      errors.push(`missing required section matching ${re.source}`)
    }
    re.lastIndex = 0
  }

  const acceptance = markdown.match(/^##\s*8[\.\)][\s\S]*?(?=^##\s|\Z)/im)?.[0] ?? ""
  if (/受け入れ|Acceptance/i.test(acceptance)) {
    const body = acceptance.replace(/^##.*$/m, "").trim()
    if (!body || body.length < 8) errors.push("acceptance criteria section is empty")
    if (/^- \[\s*\]\s*$/m.test(body) && body.split("\n").filter((l) => l.trim()).length <= 1) {
      errors.push("acceptance criteria has only an empty checkbox")
    }
  }

  if (!/Evidence\s*ID|evd_|EVB-/i.test(markdown)) {
    errors.push("brief must reference at least one Evidence ID (evd_… or EVB-…)")
  }

  const secret = assertSafeForArtifact(markdown)
  if (!secret.ok) {
    errors.push(`secret/PII scan failed: ${secret.message}`)
  } else if (secret.redacted) {
    warnings.push(`redacted secret patterns: ${secret.hits.join(", ")}`)
  }

  const raw = redactSecrets(markdown)
  if (raw.hits.length && /AKIA[0-9A-Z]{16}|BEGIN .*PRIVATE KEY/.test(markdown)) {
    errors.push("brief still contains raw secret material")
  }

  if (!/Rollback/i.test(markdown)) {
    errors.push("rollback plan required")
  }

  return { ok: errors.length === 0, errors, warnings }
}

/** Strip secrets before saving; returns cleaned markdown or failure. */
export function sanitizeBriefForSave(markdown: string) {
  const v = validateHardBrief(markdown)
  if (!v.ok) return { ok: false as const, errors: v.errors, warnings: v.warnings }
  const cleaned = redactSecrets(markdown)
  return { ok: true as const, markdown: cleaned.text, redacted: cleaned.redacted, warnings: v.warnings }
}

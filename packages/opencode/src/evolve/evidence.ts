/**
 * Read-only Evidence API for Continuous Self-Evolution.
 * Spec: docs/evolve/completion-instructions.md §7.3
 * Does not give LLMs raw DB access — callers get redacted, scoped Evidence.
 */
import { createHash, randomBytes } from "crypto"

export type EvidenceKind =
  | "message"
  | "tool"
  | "error"
  | "permission"
  | "test"
  | "correction"
  | "friction"
  | "other"

export type EvidenceRecord = {
  id: string
  projectID: string
  repositoryID?: string
  workspaceFingerprint?: string
  kind: EvidenceKind
  summary: string
  /** Redacted excerpt — never raw secrets. */
  excerpt?: string
  sourceLocator: {
    sessionID?: string
    messageID?: string
    path?: string
    label?: string
  }
  observedAt: number
  fingerprint: string
  redacted: boolean
}

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "aws_key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  { name: "private_key", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "generic_token", re: /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}/gi },
  { name: "connection_string", re: /\b(?:postgres|mysql|mongodb|redis):\/\/[^\s]+/gi },
]

export function redactSecrets(text: string): { text: string; redacted: boolean; hits: string[] } {
  let out = text
  const hits: string[] = []
  for (const p of SECRET_PATTERNS) {
    if (p.re.test(out)) {
      hits.push(p.name)
      out = out.replace(p.re, `[REDACTED:${p.name}]`)
    }
    p.re.lastIndex = 0
  }
  return { text: out, redacted: hits.length > 0, hits }
}

export function evidenceFingerprint(input: {
  projectID: string
  kind: EvidenceKind
  summary: string
  sourceLocator: EvidenceRecord["sourceLocator"]
  observedAt: number
}) {
  const h = createHash("sha256")
  h.update(
    JSON.stringify({
      projectID: input.projectID,
      kind: input.kind,
      summary: input.summary,
      sourceLocator: input.sourceLocator,
      observedAt: input.observedAt,
    }),
  )
  return h.digest("hex").slice(0, 32)
}

export function createEvidence(input: {
  projectID: string
  kind: EvidenceKind
  summary: string
  excerpt?: string
  repositoryID?: string
  workspaceFingerprint?: string
  sourceLocator?: EvidenceRecord["sourceLocator"]
  observedAt?: number
}): EvidenceRecord {
  const observedAt = input.observedAt ?? Date.now()
  const summaryRedact = redactSecrets(input.summary)
  const excerptRedact = input.excerpt ? redactSecrets(input.excerpt) : undefined
  const sourceLocator = input.sourceLocator ?? {}
  const fingerprint = evidenceFingerprint({
    projectID: input.projectID,
    kind: input.kind,
    summary: summaryRedact.text,
    sourceLocator,
    observedAt,
  })
  return {
    id: `evd_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`,
    projectID: input.projectID,
    repositoryID: input.repositoryID,
    workspaceFingerprint: input.workspaceFingerprint,
    kind: input.kind,
    summary: summaryRedact.text,
    excerpt: excerptRedact?.text,
    sourceLocator,
    observedAt,
    fingerprint,
    redacted: summaryRedact.redacted || Boolean(excerptRedact?.redacted),
  }
}

/** Refuse storing raw trajectory blobs that still look secret-bearing after redact. */
export function assertSafeForArtifact(text: string) {
  const { redacted, hits, text: cleaned } = redactSecrets(text)
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(cleaned)) {
    return { ok: false as const, message: "private key material remains after redaction", hits }
  }
  return { ok: true as const, text: cleaned, redacted, hits }
}

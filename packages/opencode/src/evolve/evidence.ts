/**
 * Read-only Evidence API for Continuous Self-Evolution.
 * Spec: docs/evolve/completion-instructions.md §7.3
 * Does not give LLMs raw DB access — callers get redacted, scoped Evidence.
 */
import { createHash, randomBytes } from "crypto"
import { redactSecrets } from "../security/secret-redact"

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

export { redactSecrets }

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

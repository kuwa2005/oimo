/**
 * Hard-evolution brief pipeline: evidence → validate → save under evolve home → no product source touch.
 */
import fs from "fs/promises"
import path from "path"
import { createHash } from "crypto"
import { createEvidence, type EvidenceRecord } from "./evidence"
import { sanitizeBriefForSave, validateHardBrief } from "./brief-validator"
import { evolveRoot } from "./store"
import { createEvolution, transition } from "./state"
import { decideEvolveWrite } from "./write-policy"
import type { EvolutionRecord } from "./evolution.sql"

export function briefContentHash(markdown: string) {
  return createHash("sha256").update(markdown).digest("hex")
}

const MINIMAL_BRIEF = (evidenceID: string) => `# Hard evolution brief

## Meta

Evidence ID: ${evidenceID}
Slug: reduce-clarification-churn
Date: 2026-09-18

## 1. Problem

Agents ask users for information already available in memory.

## 2. Evidence

See ${evidenceID}. Repeated across projects.

## 3. Affected surfaces

session prompt, memory injection

## 4. Proposed change

Prefer memory search before clarifying questions.

## 5. Alternatives considered

Project skill only — insufficient for product-common behavior.

## 6. Risks

Over-trusting stale memory.

## 7. Implementation sketch

Add pre-clarify memory lookup in core prompt assembly.

## 8. Acceptance criteria

- [ ] Clarification rate drops on fixture excess-clarification-basic
- [ ] Memory miss still allows one clarifying question

## 9. Dependencies

None

## Security / Privacy

No secret retention; redacted Evidence only.

## Test plan

Run evolve scenario fixtures and unit tests under packages/opencode.

## Rollback plan

Revert the prompt assembly change; leave skills untouched.

## Out of scope

Project-specific conventions.

## Why not soft evolution

This is product-common agent behavior; project skills cannot fix it for all installs.
`

export async function hardBriefLoop(input: {
  projectID: string
  worktree: string
  markdown?: string
  evidenceSummary: string
  productSourceProbe?: string
}): Promise<{
  ok: boolean
  evidence?: EvidenceRecord
  evolution?: EvolutionRecord
  briefPath?: string
  briefHash?: string
  errors: string[]
  productSourceUntouched: boolean
}> {
  const errors: string[] = []
  const evidence = createEvidence({
    projectID: input.projectID,
    kind: "friction",
    summary: input.evidenceSummary,
  })

  const markdown = input.markdown ?? MINIMAL_BRIEF(evidence.id)
  const sanitized = sanitizeBriefForSave(markdown)
  if (!sanitized.ok) {
    return {
      ok: false,
      evidence,
      errors: sanitized.errors,
      productSourceUntouched: true,
    }
  }

  const v = validateHardBrief(sanitized.markdown)
  if (!v.ok) {
    return { ok: false, evidence, errors: v.errors, productSourceUntouched: true }
  }

  const briefsDir = path.join(evolveRoot(input.projectID), "briefs")
  const briefPath = path.join(briefsDir, `${new Date().toISOString().slice(0, 10)}-hard-e2e.md`)
  const write = decideEvolveWrite({
    projectID: input.projectID,
    worktree: input.worktree,
    absolutePath: briefPath,
    track: "hard-brief",
  })
  if (!write.ok) {
    return { ok: false, evidence, errors: [write.message], productSourceUntouched: true }
  }

  let beforeProbe = ""
  if (input.productSourceProbe) {
    beforeProbe = await fs.readFile(input.productSourceProbe, "utf8").catch(() => "")
  }

  await fs.mkdir(briefsDir, { recursive: true })
  await fs.writeFile(briefPath, sanitized.markdown, "utf8")
  const briefHash = briefContentHash(sanitized.markdown)

  let evolution = createEvolution({
    projectID: input.projectID,
    kind: "hard-brief",
    evidenceIDs: [evidence.id],
    title: "hard brief e2e",
  })
  evolution = transition({ id: evolution.id, to: "candidate" })
  evolution = transition({ id: evolution.id, to: "planned" })
  evolution = transition({
    id: evolution.id,
    to: "generated",
    briefPath,
    briefContentHash: briefHash,
  })
  evolution = transition({ id: evolution.id, to: "validating" })
  evolution = transition({
    id: evolution.id,
    to: "accepted",
    result: { verdict: "pass", notes: ["brief validated; product source untouched"] },
  })

  let productSourceUntouched = true
  if (input.productSourceProbe) {
    const after = await fs.readFile(input.productSourceProbe, "utf8").catch(() => "")
    productSourceUntouched = beforeProbe === after
    if (!productSourceUntouched) errors.push("product source was modified during hard brief loop")
  }

  const denyProduct = decideEvolveWrite({
    projectID: input.projectID,
    worktree: input.worktree,
    absolutePath: path.join(input.worktree, "packages", "opencode", "src", "index.ts"),
    track: "hard-brief",
  })
  if (denyProduct.ok) {
    errors.push("hard-brief must not allow product source writes")
    productSourceUntouched = false
  }

  return {
    ok: errors.length === 0,
    evidence,
    evolution,
    briefPath,
    briefHash,
    errors,
    productSourceUntouched,
  }
}

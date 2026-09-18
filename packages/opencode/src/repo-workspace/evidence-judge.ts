/**
 * Deterministic Goal Judge helper for multi-repo completion evidence.
 * Parses docs/multi-repo/completion-evidence.md (or a caller-supplied path)
 * and refuses ok:true while the manifest says IN PROGRESS or any release
 * blocker is not done.
 */

import * as fs from "fs"
import path from "path"

export type EvidenceAudit = {
  ok: boolean
  reason: string
  blockers: Array<{ id: string; status: string; title: string }>
  unfinished: Array<{ id: string; status: string; title: string }>
}

const BLOCKER_ROW =
  /^\|\s*(\d+)\s*\|\s*([^|]+)\|\s*\*\*([^*]+)\*\*\s*\|/gm

export function defaultEvidencePath(cwd = process.cwd()) {
  return path.join(cwd, "docs", "multi-repo", "completion-evidence.md")
}

export function auditEvidenceManifest(filePath: string): EvidenceAudit {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      reason: `evidence manifest missing: ${filePath}`,
      blockers: [],
      unfinished: [],
    }
  }
  const text = fs.readFileSync(filePath, "utf8")
  if (/IN PROGRESS/i.test(text) || /not release-complete/i.test(text)) {
    // Still collect blockers for the reason string
  }

  const blockers: EvidenceAudit["blockers"] = []
  for (const m of text.matchAll(BLOCKER_ROW)) {
    blockers.push({
      id: m[1],
      title: m[2].trim(),
      status: m[3].trim().toLowerCase(),
    })
  }

  const unfinished = blockers.filter((b) => {
    const s = b.status
    return !(s === "done" || s.startsWith("done ") || s.startsWith("done(") || s.includes("done (scoped)"))
  })

  const inProgress = /IN PROGRESS/i.test(text) || /not release-complete/i.test(text)
  if (inProgress || unfinished.length) {
    const names = unfinished.map((b) => `#${b.id}:${b.status}`).join(", ")
    return {
      ok: false,
      reason: inProgress
        ? `evidence manifest is IN PROGRESS; unfinished blockers: ${names || "(header only)"}`
        : `evidence manifest has unfinished blockers: ${names}`,
      blockers,
      unfinished,
    }
  }

  if (!blockers.length) {
    return {
      ok: false,
      reason: "evidence manifest has no release-blocker table rows to audit",
      blockers,
      unfinished: [],
    }
  }

  return {
    ok: true,
    reason: `all ${blockers.length} release blockers marked done in ${path.basename(filePath)}`,
    blockers,
    unfinished: [],
  }
}

/** Fail closed when a Goal binds an evidenceManifestPath. */
export function assertEvidenceAllowsComplete(filePath: string): { ok: true; reason: string } | { ok: false; reason: string } {
  const audit = auditEvidenceManifest(filePath)
  if (audit.ok) return { ok: true, reason: audit.reason }
  return { ok: false, reason: audit.reason }
}

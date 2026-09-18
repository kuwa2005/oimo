/**
 * Deterministic Judge for docs/evolve/completion-evidence.md
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
  return path.join(cwd, "docs", "evolve", "completion-evidence.md")
}

function statusDone(s: string) {
  const n = s.trim().toLowerCase()
  return n === "done" || n.startsWith("done ") || n.startsWith("done(") || n.includes("done (scoped)")
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
  const blockers: EvidenceAudit["blockers"] = []
  for (const m of text.matchAll(BLOCKER_ROW)) {
    blockers.push({
      id: m[1]!,
      title: m[2]!.trim(),
      status: m[3]!.trim().toLowerCase(),
    })
  }

  const unfinished = blockers.filter((b) => !statusDone(b.status))
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

  if (!/##\s*Security\s*\/\s*Privacy review/i.test(text) && !/##\s*Security and privacy review/i.test(text)) {
    return {
      ok: false,
      reason: "evidence manifest missing Security / Privacy review section",
      blockers,
      unfinished: [],
    }
  }
  if (/CRITICAL FINDING|重大所見/i.test(text) && !/重大所見なし|no critical findings/i.test(text)) {
    return {
      ok: false,
      reason: "evidence manifest still reports critical security/privacy findings",
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

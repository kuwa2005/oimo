/**
 * Pending human handoff for hard-evolution briefs.
 */
import path from "path"
import fs from "fs/promises"
import { evolveRoot } from "./store"
import { listEvolutions } from "./state"
import { briefContentHash } from "./hard-loop"

export type PendingHandoff = {
  briefFile: string
  briefPath: string
  briefHash?: string
  evolutionID?: string
  title?: string
  status: "pending_human" | "accepted_in_db"
  updatedAt?: number
}

export async function listPendingHandoffs(projectID: string): Promise<PendingHandoff[]> {
  const briefsDir = path.join(evolveRoot(projectID), "briefs")
  let files: string[] = []
  try {
    files = (await fs.readdir(briefsDir)).filter((f) => f.endsWith(".md")).sort().reverse()
  } catch {
    return []
  }

  const evolutions = listEvolutions(projectID, 100).filter((e) => e.kind === "hard-brief")
  const byPath = new Map(evolutions.filter((e) => e.briefPath).map((e) => [e.briefPath!, e]))

  const out: PendingHandoff[] = []
  for (const file of files.slice(0, 20)) {
    const briefPath = path.join(briefsDir, file)
    const evo = byPath.get(briefPath) ?? evolutions.find((e) => e.briefPath?.endsWith(file))
    const text = await Bun.file(briefPath).text().catch(() => "")
    const title =
      text.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
      text.match(/^Slug:\s*(.+)$/m)?.[1]?.trim() ??
      file
    out.push({
      briefFile: file,
      briefPath,
      briefHash: text ? briefContentHash(text) : undefined,
      evolutionID: evo?.id,
      title,
      status: evo?.status === "accepted" ? "accepted_in_db" : "pending_human",
      updatedAt: evo?.updatedAt,
    })
  }
  return out
}

export function formatPendingHandoffs(items: PendingHandoff[]): string {
  if (!items.length) return "No pending hard-evolution briefs for human handoff."
  return [
    "# Pending hard-evolution handoffs",
    "",
    "These briefs are for an external coding agent. oimo does not modify product source here.",
    "",
    ...items.map(
      (h) =>
        `- \`${h.briefFile}\` [${h.status}] ${h.title ?? ""}${h.briefHash ? ` hash=${h.briefHash.slice(0, 12)}` : ""}`,
    ),
  ].join("\n")
}

import path from "path"
import fs from "fs/promises"

export type BriefLifecycle = "open" | "implemented" | "verified" | "unknown"

export type BriefStatusEntry = {
  file: string
  lifecycle: BriefLifecycle
  raw?: string
  warning?: string
}

const STATUS_RE = /^Status:\s*(.+)$/im

export function lifecycleFromStatusLine(raw: string): BriefLifecycle {
  const normalized = raw.trim().toLowerCase()
  if (/\bverified\b/.test(normalized)) return "verified"
  if (/\bimplemented\b/.test(normalized)) return "implemented"
  if (/\bopen\b|\bpending\b|\bdetected\b|\bcandidate\b/.test(normalized)) return "open"
  if (!normalized) return "unknown"
  return "open"
}

export function parseBriefStatusFromMarkdown(markdown: string): BriefStatusEntry {
  const match = STATUS_RE.exec(markdown)
  if (!match) {
    return {
      file: "",
      lifecycle: "unknown",
      warning: "missing Status line",
    }
  }
  const raw = match[1].trim()
  return {
    file: "",
    lifecycle: lifecycleFromStatusLine(raw),
    raw,
  }
}

export async function readBriefStatuses(briefsDir: string): Promise<BriefStatusEntry[]> {
  let files: string[] = []
  try {
    files = (await fs.readdir(briefsDir))
      .filter((f) => f.endsWith(".md"))
      .sort()
  } catch {
    return []
  }

  const out: BriefStatusEntry[] = []
  for (const file of files) {
    const full = path.join(briefsDir, file)
    const text = await Bun.file(full).text().catch(() => "")
    const parsed = parseBriefStatusFromMarkdown(text)
    out.push({ ...parsed, file })
  }
  return out
}

export function countOpenBriefs(entries: BriefStatusEntry[]): number {
  return entries.filter((e) => e.lifecycle === "open" || e.lifecycle === "unknown").length
}

export function openBriefFiles(entries: BriefStatusEntry[]): string[] {
  return entries
    .filter((e) => e.lifecycle === "open" || e.lifecycle === "unknown")
    .map((e) => e.file)
}

export function deriveIndexMarkdown(input: {
  statuses: BriefStatusEntry[]
  generatedAt?: number
  notes?: string
}): string {
  const at = new Date(input.generatedAt ?? Date.now()).toISOString()
  const lines = [
    "# Self-evolution INDEX",
    "",
    `Generated from brief files at ${at}`,
    "",
    "## Brief checklist",
    "",
    ...input.statuses.map((s) => {
      const done = s.lifecycle === "verified" || s.lifecycle === "implemented"
      const box = done ? "[x]" : "[ ]"
      const label =
        s.lifecycle === "unknown"
          ? `${s.file} (unknown${s.warning ? `: ${s.warning}` : ""})`
          : `${s.file} (${s.lifecycle})`
      return `- ${box} ${label}`
    }),
  ]
  if (input.notes?.trim()) {
    lines.push("", "## Notes (preserved)", "", input.notes.trim())
  }
  return lines.join("\n") + "\n"
}

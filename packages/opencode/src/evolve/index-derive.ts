import path from "path"
import fs from "fs/promises"
import { deriveIndexMarkdown, readBriefStatuses } from "./brief-status"
import type { ResolvedEvolveRoots } from "./evolve-scope"

/** Derive INDEX.md body from brief Status lines (brief meta is source of truth). */
export async function deriveIndexForRoot(root: string, existingIndex?: string): Promise<string> {
  const statuses = await readBriefStatuses(path.join(root, "briefs"))
  let notes: string | undefined
  if (existingIndex) {
    const m = /## Notes \(preserved\)\s*([\s\S]*?)(?=^## |\Z)/m.exec(existingIndex)
    if (m?.[1]?.trim()) notes = m[1].trim()
  }
  return deriveIndexMarkdown({ statuses, notes })
}

export async function writeDerivedIndex(roots: ResolvedEvolveRoots): Promise<{ path: string; markdown: string }> {
  const indexPath = path.join(roots.effective, "INDEX.md")
  const existing = (await Bun.file(indexPath).exists()) ? await Bun.file(indexPath).text() : undefined
  const markdown = await deriveIndexForRoot(roots.effective, existing)
  await fs.mkdir(roots.effective, { recursive: true })
  await Bun.write(indexPath, markdown)
  return { path: indexPath, markdown }
}

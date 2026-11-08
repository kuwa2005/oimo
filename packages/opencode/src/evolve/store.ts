import path from "path"
import fs from "fs/promises"
import { Global } from "@/global"
import { readBriefStatuses, countOpenBriefs, openBriefFiles, type BriefStatusEntry } from "./brief-status"
import { resolveEvolveRootsAsync, type EvolveRootSource } from "./evolve-scope"

export type EvolveDashboard = {
  root: string
  projectRoot: string
  globalRoot: string
  source: EvolveRootSource
  index?: string
  backlogOpen: number
  /** Brief filenames still open by Status meta (not raw file count). */
  briefsOpen: string[]
  /** All brief files under effective root. */
  briefsAll: string[]
  briefStatuses: BriefStatusEntry[]
  frictionReports: string[]
  reviews: string[]
  historyHead?: string
  skillsCount: number
  pendingHandoffs: number
  globalCounts?: {
    backlogOpen: number
    briefsOpen: number
    briefsAll: number
  }
}

/** Parent dir for all projects' self-evolution logs: `~/.oimo/evolve`. */
export function evolveHome() {
  return path.join(Global.Path.home, ".oimo", "evolve")
}

/** Per-project self-evolution log root: `~/.oimo/evolve/<projectID>`. */
export function evolveRoot(projectID: string) {
  return path.join(evolveHome(), projectID)
}

async function readIfExists(file: string) {
  const exists = await Bun.file(file).exists()
  if (!exists) return undefined
  return Bun.file(file).text()
}

async function listMarkdown(dir: string) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "README.md")
      .map((e) => e.name)
      .sort()
      .reverse()
  } catch {
    return [] as string[]
  }
}

async function countBacklogOpen(backlogPath: string): Promise<number> {
  const backlog = await readIfExists(backlogPath)
  return backlog
    ? [...backlog.matchAll(/Status:\s*(Detected|Analyzing|Candidate|Approved|Instruction Generated)/gi)].length
    : 0
}

async function loadRootSlice(root: string) {
  const briefStatuses = await readBriefStatuses(path.join(root, "briefs"))
  const briefsAll = briefStatuses.map((b) => b.file)
  return {
    briefStatuses,
    briefsAll,
    briefsOpen: openBriefFiles(briefStatuses),
    backlogOpen: await countBacklogOpen(path.join(root, "backlog", "BACKLOG.md")),
    frictionReports: await listMarkdown(path.join(root, "friction")),
    reviews: await listMarkdown(path.join(root, "reviews")),
    index: await readIfExists(path.join(root, "INDEX.md")),
    history: await readIfExists(path.join(root, "history", "HISTORY.md")),
  }
}

export async function loadDashboard(input: { projectID: string; worktree: string }): Promise<EvolveDashboard> {
  const roots = await resolveEvolveRootsAsync(input.projectID)
  const effective = await loadRootSlice(roots.effective)

  let globalCounts: EvolveDashboard["globalCounts"]
  if (roots.source === "global" && input.projectID !== "global") {
    const g = await loadRootSlice(roots.global)
    globalCounts = {
      backlogOpen: g.backlogOpen,
      briefsOpen: countOpenBriefs(g.briefStatuses),
      briefsAll: g.briefsAll.length,
    }
  }

  let skillsCount = 0
  try {
    const entries = await fs.readdir(path.join(input.worktree, ".oimo", "skills"), { withFileTypes: true })
    skillsCount = entries.filter((e) => e.isDirectory()).length
  } catch {
    skillsCount = 0
  }

  const historyHead = effective.history
    ?.split(/\n(?=## )/)
    .filter((b) => b.startsWith("## "))
    .at(0)
    ?.split("\n")
    .slice(0, 6)
    .join("\n")

  return {
    root: roots.effective,
    projectRoot: roots.project,
    globalRoot: roots.global,
    source: roots.source,
    index: effective.index,
    backlogOpen: effective.backlogOpen,
    briefsOpen: effective.briefsOpen,
    briefsAll: effective.briefsAll,
    briefStatuses: effective.briefStatuses,
    frictionReports: effective.frictionReports,
    reviews: effective.reviews,
    historyHead,
    skillsCount,
    pendingHandoffs: effective.briefsOpen.length,
    globalCounts,
  }
}

export function formatDashboard(d: EvolveDashboard): string {
  const sourceLine =
    d.source === "global"
      ? `Data source: **global** fallback (project tree empty; counts below are from \`${d.globalRoot}\`)`
      : d.source === "project"
        ? `Data source: **project** (\`${d.root}\`)`
        : `Data source: **none** (no evolve artifacts under project or global)`
  return [
    `# Self Evolution`,
    ``,
    `Root: \`${d.root}\``,
    sourceLine,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Skills (project) | ${d.skillsCount} |`,
    `| Backlog open | ${d.backlogOpen} |`,
    `| Briefs open (by Status) | ${d.briefsOpen.length} |`,
    `| Brief files total | ${d.briefsAll.length} |`,
    `| Pending handoffs | ${d.pendingHandoffs} |`,
    `| Friction reports | ${d.frictionReports.length} |`,
    `| Reviews | ${d.reviews.length} |`,
    ...(d.globalCounts
      ? [
          ``,
          `### Global inventory (referenced)`,
          ``,
          `| Metric | Value |`,
          `|--------|-------|`,
          `| Global backlog open | ${d.globalCounts.backlogOpen} |`,
          `| Global briefs open | ${d.globalCounts.briefsOpen} |`,
          `| Global brief files | ${d.globalCounts.briefsAll} |`,
        ]
      : []),
    ``,
    `## Open briefs (human handoff)`,
    ...(d.briefsOpen.length
      ? d.briefsOpen.slice(0, 12).map((b) => `- ${b} — pass to external agent; do not auto-apply`)
      : ["- (none)"]),
    ``,
    `## Brief status summary`,
    ...(d.briefStatuses.length
      ? d.briefStatuses.map((s) => `- ${s.file}: ${s.lifecycle}${s.warning ? ` (${s.warning})` : ""}`)
      : ["- (none)"]),
    ``,
    `## Recent friction`,
    ...(d.frictionReports.length ? d.frictionReports.slice(0, 5).map((b) => `- ${b}`) : ["- (none)"]),
    ``,
    `## History head`,
    d.historyHead ?? "(no history yet)",
    ``,
    d.index ? `## INDEX.md\n\n${d.index.slice(0, 4000)}` : "## INDEX.md\n\n(missing — run /evolve)",
  ].join("\n")
}

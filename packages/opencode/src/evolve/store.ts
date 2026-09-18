import path from "path"
import fs from "fs/promises"
import { Global } from "@/global"

export type EvolveDashboard = {
  root: string
  index?: string
  backlogOpen: number
  briefsOpen: string[]
  frictionReports: string[]
  reviews: string[]
  historyHead?: string
  skillsCount: number
  pendingHandoffs: number
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

export async function loadDashboard(input: { projectID: string; worktree: string }): Promise<EvolveDashboard> {
  const root = evolveRoot(input.projectID)
  const index = await readIfExists(path.join(root, "INDEX.md"))
  const backlog = await readIfExists(path.join(root, "backlog", "BACKLOG.md"))
  const history = await readIfExists(path.join(root, "history", "HISTORY.md"))
  const briefsOpen = await listMarkdown(path.join(root, "briefs"))
  const frictionReports = await listMarkdown(path.join(root, "friction"))
  const reviews = await listMarkdown(path.join(root, "reviews"))

  let skillsCount = 0
  try {
    const entries = await fs.readdir(path.join(input.worktree, ".oimo", "skills"), { withFileTypes: true })
    skillsCount = entries.filter((e) => e.isDirectory()).length
  } catch {
    skillsCount = 0
  }

  const backlogOpen = backlog
    ? [...backlog.matchAll(/Status:\s*(Detected|Analyzing|Candidate|Approved|Instruction Generated)/gi)].length
    : 0

  const historyHead = history
    ?.split(/\n(?=## )/)
    .filter((b) => b.startsWith("## "))
    .at(0)
    ?.split("\n")
    .slice(0, 6)
    .join("\n")

  return {
    root,
    index,
    backlogOpen,
    briefsOpen,
    frictionReports,
    reviews,
    historyHead,
    skillsCount,
    pendingHandoffs: briefsOpen.length,
  }
}

export function formatDashboard(d: EvolveDashboard): string {
  return [
    `# Self Evolution`,
    ``,
    `Root: \`${d.root}\``,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Skills (project) | ${d.skillsCount} |`,
    `| Backlog open | ${d.backlogOpen} |`,
    `| Briefs | ${d.briefsOpen.length} |`,
    `| Pending handoffs | ${d.pendingHandoffs} |`,
    `| Friction reports | ${d.frictionReports.length} |`,
    `| Reviews | ${d.reviews.length} |`,
    ``,
    `## Open briefs (human handoff)`,
    ...(d.briefsOpen.length
      ? d.briefsOpen.slice(0, 12).map((b) => `- ${b} — pass to external agent; do not auto-apply`)
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

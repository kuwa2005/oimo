#!/usr/bin/env bun
/**
 * Export oimo builtin skills, compose phases, and workflow patterns to agent-skills.
 *
 * Usage:
 *   bun script/export-agent-skills.ts
 *   AGENT_SKILLS_ROOT=/path/to/agent-skills bun script/export-agent-skills.ts
 *   bun script/export-agent-skills.ts --dry-run
 *
 * See docs/agent-skills-export.md
 */
import path from "path"
import { readdir, mkdir, rm, writeFile, readFile } from "node:fs/promises"

const repoRoot = path.join(import.meta.dir, "..")
const agentSkillsRoot = process.env.AGENT_SKILLS_ROOT ?? path.join(repoRoot, "../agent-skills")
const skillsOut = path.join(agentSkillsRoot, "skills")
const dryRun = process.argv.includes("--dry-run")

const builtinRoot = path.join(repoRoot, "packages/opencode/src/skill/builtin/.bundle")
const composeRoot = path.join(repoRoot, "packages/opencode/src/skill/compose/.bundle")
const workflowRoot = path.join(repoRoot, "packages/opencode/src/workflow/builtin")

/** Copy as-is when host-agnostic. */
const BUILTIN_DIRECT = [
  "compose-next",
  "deep-research",
  "super-research",
  "arxiv",
  "design-blueprint",
  "skill-creator",
  "playwright",
  "pdf-official",
  "docx-official",
  "pptx-official",
  "xlsx-official",
  "modern-python-toolchain",
  "research-paper-writing",
  "learn-everything",
  "loop",
  "data-analytics",
  "product-design",
  "html-to-video-pipeline",
  "grok-build",
  "claude-code",
  "codex",
] as const

/** oimo-only — not exported. */
const BUILTIN_SKIP = new Set(["mimocode-docs", "drive-mimo", "sales"])

const COMPOSE_PHASES = [
  "ask",
  "brainstorm",
  "debug",
  "execute",
  "feedback",
  "merge",
  "parallel",
  "plan",
  "report",
  "review",
  "subagent",
  "tdd",
  "verify",
  "worktree",
] as const

const WORKFLOW_FILES = [
  "compose.js",
  "deep-research.js",
  "evolve-review.js",
  "evolve-apply.js",
  "fact-check.js",
  "research-experiment.js",
] as const

const HOST_PATHS_MD = `# Host paths (portable skills from oimo)

Use the paths for the agent host you are on. oimo paths are listed for reference when the same skill runs inside Open Mimo Code.

| Artifact | Cursor | OpenCode | oimo |
|----------|--------|----------|------|
| Personal skills | \`~/.cursor/skills/\` | \`~/.config/opencode/skills/\` | \`~/.config/oimo/skills/\` |
| Project skills | \`.cursor/skills/\` | \`.opencode/skills/\` | \`.oimo/skills/\` |
| Evolve / briefs dir | \`~/.cursor/evolve/<project>/\` or project \`.cursor/evolve/\` | \`~/.config/opencode/evolve/<project>/\` | \`~/.oimo/evolve/<projectID>/\` |
| Trajectory / session DB | — | — | \`~/.local/share/oimo/oimo.db\` (readonly SQL) |
| Project memory | \`MEMORY.md\` at repo root (convention) | same | same (+ oimo checkpoint files) |

When a skill mentions \`.oimo/\`, substitute your host's project skills directory unless you are on oimo.
`

async function exists(p: string) {
  return Bun.file(p)
    .stat()
    .then(() => true)
    .catch(() => false)
}

async function copyDir(src: string, dest: string) {
  if (!(await exists(src))) {
    console.warn(`skip missing: ${src}`)
    return
  }
  if (dryRun) {
    console.log(`[dry-run] copy ${src} -> ${dest}`)
    return
  }
  await rm(dest, { recursive: true, force: true })
  await Bun.spawn(["cp", "-a", src, dest]).exited
}

function sanitizeComposeName(dir: string) {
  return dir.replace(/^compose:/, "compose-").replace(/:/g, "-")
}

/** Quote description when colons would break YAML (common in long trigger lists). */
function quoteYamlDescription(text: string) {
  const match = text.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return text
  const descMatch = match[1].match(/^description:\s*(.+)$/m)
  if (!descMatch) return text
  const raw = descMatch[1].trim()
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return text
  if (!raw.includes(":")) return text
  const quoted = `"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
  const fm = match[1].replace(/^description:\s*.+$/m, `description: ${quoted}`)
  return text.replace(/^---\n[\s\S]*?\n---/, `---\n${fm}\n---`)
}

async function sanitizeSkillFrontmatter(skillDir: string) {
  const skillMd = path.join(skillDir, "SKILL.md")
  if (!(await exists(skillMd))) return
  const text = quoteYamlDescription(await readFile(skillMd, "utf8"))
  if (!dryRun) await writeFile(skillMd, text)
}

async function patchSkillName(skillDir: string, name: string) {
  const skillMd = path.join(skillDir, "SKILL.md")
  if (!(await exists(skillMd))) return
  let text = await readFile(skillMd, "utf8")
  text = text.replace(/^name:\s*.+$/m, `name: ${name}`)
  text = text.replace(/^name:\s*".+"$/m, `name: ${name}`)
  if (!dryRun) await writeFile(skillMd, text)
}

async function exportBuiltinDirect(name: string) {
  const dest = path.join(skillsOut, name)
  await copyDir(path.join(builtinRoot, name), dest)
  if (!dryRun) await sanitizeSkillFrontmatter(dest)
}

async function exportEvolvePortable() {
  const dest = path.join(skillsOut, "evolve")
  await copyDir(path.join(builtinRoot, "evolve"), dest)
  if (dryRun) return
  await mkdir(path.join(dest, "references"), { recursive: true })
  await writeFile(path.join(dest, "references", "host-paths.md"), HOST_PATHS_MD)
  const skillMd = path.join(dest, "SKILL.md")
  let text = await readFile(skillMd, "utf8")
  const portable = `---
name: evolve
description: Use when repeated friction, user corrections, or durable learnings should become project skills, hooks, workflows, or product-improvement briefs. Portable across Cursor, OpenCode, and oimo — see references/host-paths.md for install paths. Triggers on "I wish I could…", same mistake twice, or measurable time sinks.
---

# Evolve — Continuous Self-Evolution (portable)

Host-specific paths: @references/host-paths.md

`
  text = text.replace(/^---[\s\S]*?---\n/, portable)
  text = text
    .replace(/~\/\.oimo\/evolve\/<projectID>/g, "`~/.cursor/evolve/<project>` (Cursor) or `~/.oimo/evolve/<projectID>` (oimo)")
    .replace(/\.oimo\/skills/g, "your host project skills dir (`.cursor/skills/`, `.opencode/skills/`, or `.oimo/skills/`)")
  await writeFile(skillMd, text)
}

async function exportMemorySearchPortable() {
  const dest = path.join(skillsOut, "memory-search")
  await copyDir(path.join(builtinRoot, "memory-search"), dest)
  if (dryRun) return
  await writeFile(path.join(dest, "references", "host-paths.md"), HOST_PATHS_MD).catch(async () => {
    await mkdir(path.join(dest, "references"), { recursive: true })
    await writeFile(path.join(dest, "references", "host-paths.md"), HOST_PATHS_MD)
  })
  const skillMd = path.join(dest, "SKILL.md")
  let text = await readFile(skillMd, "utf8")
  const note = `\n## Host note\n\nThis skill targets **oimo's** trajectory SQLite (\`~/.local/share/oimo/oimo.db\`). On Cursor/OpenCode there is no equivalent DB — use git history, session exports, or your host's logs instead. See @references/host-paths.md.\n`
  if (!text.includes("## Host note")) text += note
  await writeFile(skillMd, text)
}

async function exportComposePhases() {
  const dest = path.join(skillsOut, "compose-phases")
  const refDest = path.join(dest, "references")
  if (dryRun) {
    console.log(`[dry-run] compose-phases -> ${dest}`)
    return
  }
  await rm(dest, { recursive: true, force: true })
  await mkdir(refDest, { recursive: true })
  for (const phase of COMPOSE_PHASES) {
    const src = path.join(composeRoot, phase)
    if (!(await exists(src))) continue
    await copyDir(src, path.join(refDest, phase))
    const refName = sanitizeComposeName(phase)
    await patchSkillName(path.join(refDest, phase), refName)
  }
  const index = `---
name: compose-phases
description: Spec-driven development phase skills exported from oimo Compose (plan, execute, verify, review, debug, TDD, worktree, merge, parallel, brainstorm, ask, feedback, report, subagent). Use compose-next for the end-to-end user-facing workflow; load individual phases from references/ when orchestrating manually on Cursor, OpenCode, or oimo.
---

# Compose phases (portable)

Exported from Open Mimo Code \`skill/compose/.bundle\`. Each phase lives under \`references/<phase>/\`.

| Phase | Path | Original skill name |
|-------|------|-------------------|
${COMPOSE_PHASES.map((p) => `| ${p} | references/${p}/SKILL.md | compose:${p} |`).join("\n")}

## Usage

1. **Full workflow on any host:** use the **compose-next** skill (also exported).
2. **Single phase:** read the matching \`references/<phase>/SKILL.md\` and announce which phase you are running.
3. **On oimo:** native \`compose:*\` skills and \`compose\` workflow JS may still be preferred when available.

Do not start compose phases unless the user asked for structured spec-driven work.
`
  await writeFile(path.join(dest, "SKILL.md"), index)
}

async function parseWorkflowMeta(file: string) {
  const text = await readFile(path.join(workflowRoot, file), "utf8")
  const name = file.replace(/\.js$/, "")
  const desc = text.match(/description:\s*\n?\s*"([^"]+)"/)?.[1] ?? ""
  const when = text.match(/whenToUse:\s*\n?\s*"([^"]+)"/s)?.[1]?.replace(/\s+/g, " ") ?? ""
  const phases: Array<{ title: string; detail: string }> = []
  const phaseRe = /title:\s*"([^"]+)"[\s\S]*?detail:\s*"([^"]+)"/g
  let m
  while ((m = phaseRe.exec(text))) phases.push({ title: m[1]!, detail: m[2]! })
  return { name, desc, when, phases }
}

async function exportWorkflowsBundle() {
  const dest = path.join(skillsOut, "oimo-workflows")
  const refDest = path.join(dest, "references")
  if (dryRun) {
    console.log(`[dry-run] oimo-workflows -> ${dest}`)
    return
  }
  await rm(dest, { recursive: true, force: true })
  await mkdir(refDest, { recursive: true })
  const rows: string[] = []
  for (const file of WORKFLOW_FILES) {
    const meta = await parseWorkflowMeta(file)
    const body = `---
name: workflow-${meta.name}
description: "${meta.desc.replace(/"/g, '\\"')}"
---

# Workflow: ${meta.name}

**When to use:** ${meta.when}

## Phases

${meta.phases.map((p, i) => `${i + 1}. **${p.title}** — ${p.detail}`).join("\n")}

## Portable orchestration

oimo runs this as \`.oimo/workflows/${meta.name}.js\` with a \`workflow\` tool. On Cursor/OpenCode, **you** orchestrate the phases: spawn subtasks or follow the phase list sequentially, writing checkpoints to disk between phases.

Source: \`packages/opencode/src/workflow/builtin/${file}\` in oimo.
`
    const fname = `${meta.name}.md`
    await writeFile(path.join(refDest, fname), body)
    rows.push(`| ${meta.name} | references/${fname} |`)
  }
  const index = `---
name: oimo-workflows
description: Multi-phase workflow patterns from oimo (compose pipeline, deep-research report, evolve review/apply, fact-check, research-experiment). Portable orchestration guides for Cursor, OpenCode, and oimo — see references/ per workflow.
---

# oimo workflows (portable)

| Workflow | Reference |
|----------|-----------|
${rows.join("\n")}

On **oimo**, prefer native \`workflow\` tool + \`.oimo/workflows/*.js\` when installed. Else follow the reference markdown manually.
`
  await writeFile(path.join(dest, "SKILL.md"), index)
}

async function exportGoalDrivenStop() {
  const dest = path.join(skillsOut, "goal-driven-stop")
  if (dryRun) {
    console.log(`[dry-run] goal-driven-stop`)
    return
  }
  await mkdir(dest, { recursive: true })
  await writeFile(
    path.join(dest, "SKILL.md"),
    `---
name: goal-driven-stop
description: Use when an autonomous agent loop should not stop until explicit success criteria are met. Portable pattern from oimo /goal — define stop conditions, require evidence before claiming done, and use an independent reviewer pass before accepting completion.
---

# Goal-driven stop conditions (portable)

Pattern exported from oimo's \`/goal\` command and judge model.

## When to use

- Long autonomous runs (implement until done, fix CI until green)
- User says "don't stop until X" or "keep going until Y passes"

## Protocol

1. **Capture goal** — Write measurable stop conditions (tests pass, PR ready, spec section S3 satisfied).
2. **Before each stop attempt** — Agent must cite evidence (command output, file state).
3. **Reviewer gate** — A separate pass (subagent or fresh context) checks conditions without assuming the worker's summary.
4. **Reject optimistic stop** — If any condition lacks evidence, continue working.

## On oimo

Use \`/goal\` to register conditions; the runtime invokes a judge model automatically.

## Elsewhere

Keep conditions in \`GOAL.md\` or the task prompt; run a explicit "goal check" subtask before ending the turn.
`,
  )
}

async function writeCatalog() {
  const exported = [
    ...BUILTIN_DIRECT,
    "evolve",
    "memory-search",
    "compose-phases",
    "oimo-workflows",
    "goal-driven-stop",
  ]
  const lines = [
    "# Exported from oimo (bun script/export-agent-skills.ts)",
    "# Install: ./install.sh compose-next evolve  OR  ./install.sh $(cat optional-oimo.txt | grep -v '^#')",
    ...exported,
    "",
  ]
  const catalogPath = path.join(skillsOut, "optional-oimo.txt")
  if (dryRun) {
    console.log(`[dry-run] write ${catalogPath}`)
    return
  }
  await writeFile(catalogPath, lines.join("\n"))
}

async function main() {
  if (!(await exists(agentSkillsRoot))) {
    console.error(`agent-skills root not found: ${agentSkillsRoot}`)
    console.error("Set AGENT_SKILLS_ROOT or clone github.com/kuwa2005/agent-skills beside oimo")
    process.exit(1)
  }
  console.log(`Exporting to ${skillsOut}${dryRun ? " (dry-run)" : ""}`)
  for (const name of BUILTIN_DIRECT) {
    if (BUILTIN_SKIP.has(name)) continue
    await exportBuiltinDirect(name)
  }
  await exportEvolvePortable()
  await exportMemorySearchPortable()
  await exportComposePhases()
  await exportWorkflowsBundle()
  await exportGoalDrivenStop()
  await writeCatalog()
  console.log("Done. Run validate: python3 validate_skills.py (in agent-skills repo)")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

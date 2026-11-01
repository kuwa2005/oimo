/**
 * Soft-evolution skill staging: validate before activate.
 * Spec: docs/evolve/completion-instructions.md §8.2
 */
import fs from "fs/promises"
import path from "path"
import { redactSecrets, assertSafeForArtifact } from "./evidence"
import { evolveRoot } from "./store"

export type SkillStageResult =
  | { ok: true; stagedPath: string; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] }

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/

export function validateSkillMarkdown(markdown: string, input?: { skillName?: string }): {
  ok: boolean
  errors: string[]
  warnings: string[]
} {
  const errors: string[] = []
  const warnings: string[] = []
  const fm = FRONTMATTER.exec(markdown)
  if (!fm) {
    errors.push("missing YAML frontmatter")
  } else {
    const body = fm[1]!
    if (!/^\s*name:\s*\S+/m.test(body)) errors.push("frontmatter missing name")
    if (!/^\s*description:\s*\S+/m.test(body)) errors.push("frontmatter missing description")
    if (input?.skillName) {
      const name = body.match(/^\s*name:\s*["']?([^\n"']+)/m)?.[1]?.trim()
      if (name && name !== input.skillName) {
        warnings.push(`frontmatter name "${name}" differs from directory "${input.skillName}"`)
      }
    }
  }
  const secret = assertSafeForArtifact(markdown)
  if (!secret.ok) errors.push(secret.message)
  else if (secret.redacted) warnings.push(`redacted: ${secret.hits.join(",")}`)

  if (/permission\s*[:=]\s*["']?\*/i.test(markdown) || /alwaysAllow|bypass/i.test(markdown)) {
    errors.push("skill must not request unrestricted permissions")
  }
  return { ok: errors.length === 0, errors, warnings }
}

/**
 * Write skill into `.oimo/skills-staging/<name>/` — never directly into active skills.
 */
export async function stageSkill(input: {
  worktree: string
  skillName: string
  files: Record<string, string>
}): Promise<SkillStageResult> {
  const warnings: string[] = []
  const errors: string[] = []
  const skillMd = input.files["SKILL.md"] ?? input.files["skill.md"]
  if (!skillMd) {
    return { ok: false, errors: ["SKILL.md required"], warnings }
  }
  const v = validateSkillMarkdown(skillMd, { skillName: input.skillName })
  errors.push(...v.errors)
  warnings.push(...v.warnings)
  if (errors.length) return { ok: false, errors, warnings }

  const stagingRoot = path.join(input.worktree, ".oimo", "skills-staging", input.skillName)
  await fs.mkdir(stagingRoot, { recursive: true })
  for (const [rel, content] of Object.entries(input.files)) {
    const cleaned = redactSecrets(content)
    if (cleaned.redacted) warnings.push(`${rel}: secrets redacted`)
    const dest = path.join(stagingRoot, rel)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, cleaned.text, "utf8")
  }
  return { ok: true, stagedPath: stagingRoot, warnings }
}

/**
 * Promote staging → active only after validation. Refuses if staging missing or invalid.
 */
export async function activateStagedSkill(input: {
  worktree: string
  skillName: string
}): Promise<SkillStageResult> {
  const stagingRoot = path.join(input.worktree, ".oimo", "skills-staging", input.skillName)
  const activeRoot = path.join(input.worktree, ".oimo", "skills", input.skillName)
  try {
    await fs.access(stagingRoot)
  } catch {
    return { ok: false, errors: [`staging missing: ${stagingRoot}`], warnings: [] }
  }
  const skillMd = await fs.readFile(path.join(stagingRoot, "SKILL.md"), "utf8").catch(() => "")
  const v = validateSkillMarkdown(skillMd, { skillName: input.skillName })
  if (!v.ok) return { ok: false, errors: v.errors, warnings: v.warnings }

  await fs.mkdir(path.dirname(activeRoot), { recursive: true })
  await fs.cp(stagingRoot, activeRoot, { recursive: true, force: true })
  return { ok: true, stagedPath: activeRoot, warnings: v.warnings }
}

/**
 * Copy evolve-scoped skills (project + shared global) into `<worktree>/.oimo/skills/`
 * when the worktree copy is missing — fixes skill_search only indexing project-local skills.
 */
export async function mirrorEvolveSkillsToWorktree(input: { worktree: string; projectID: string }) {
  const destRoot = path.join(input.worktree, ".oimo", "skills")
  const sources = [
    path.join(evolveRoot(input.projectID), "skills"),
    ...(input.projectID === "global" ? [] : [path.join(evolveRoot("global"), "skills")]),
  ]
  const warnings: string[] = []
  for (const srcRoot of sources) {
    let entries: { name: string; isDirectory: () => boolean }[]
    try {
      entries = await fs.readdir(srcRoot, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillMd = path.join(srcRoot, entry.name, "SKILL.md")
      try {
        await fs.access(skillMd)
      } catch {
        continue
      }
      const dest = path.join(destRoot, entry.name)
      const destMd = path.join(dest, "SKILL.md")
      try {
        await fs.access(destMd)
        continue
      } catch {
        await fs.mkdir(dest, { recursive: true })
        await fs.cp(path.join(srcRoot, entry.name), dest, { recursive: true })
      }
    }
  }
  return { ok: true as const, warnings }
}

/** Remove an activated skill (used by soft rollback when snapshot lacks the skill tree). */
export async function deactivateSkill(input: {
  worktree: string
  skillName: string
}): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const activeRoot = path.join(input.worktree, ".oimo", "skills", input.skillName)
  try {
    await fs.rm(activeRoot, { recursive: true, force: true })
  } catch (e) {
    return { ok: false, errors: [`deactivate failed: ${String(e)}`] }
  }
  return { ok: true }
}

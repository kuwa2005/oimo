/**
 * Write-root Policy for evolve / dream / distill system agents.
 * Spec: docs/evolve/completion-instructions.md §6.1
 */
import path from "path"
import fs from "fs"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { Global } from "@/global"
import { evolveRoot } from "./store"

export type EvolveWriteDecision =
  | { ok: true; root: "memory" | "project-oimo" | "evolve-home" }
  | { ok: false; code: string; message: string }

function realOrSelf(p: string) {
  try {
    return fs.realpathSync(p)
  } catch {
    return AppFileSystem.resolve(p)
  }
}

function under(root: string, target: string) {
  const r = realOrSelf(root)
  const t = realOrSelf(target)
  return t === r || AppFileSystem.contains(r, t)
}

/**
 * Fail closed: evolve agents may only write memory, project `.oimo` extensions,
 * or `~/.oimo/evolve/<projectID>/`. Never product source or other projects.
 */
export function decideEvolveWrite(input: {
  projectID: string
  worktree: string
  absolutePath: string
  track: "dream" | "distill" | "evolve" | "hard-brief"
}): EvolveWriteDecision {
  const abs = AppFileSystem.resolve(input.absolutePath)
  // Reject if any path segment is a symlink escape after resolving nearest existing parent
  let probe = abs
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) {
    probe = path.dirname(probe)
  }
  const resolvedTarget = fs.existsSync(probe)
    ? path.join(fs.realpathSync(probe), path.relative(probe, abs))
    : abs

  const memoryRoot = path.join(Global.Path.data, "memory")
  const projectOimo = path.join(input.worktree, ".oimo")
  const homeEvolve = evolveRoot(input.projectID)
  const allEvolveHome = path.join(Global.Path.home, ".oimo", "evolve")

  // Cross-project: any path under ~/.oimo/evolve that is NOT this projectID
  if (under(allEvolveHome, resolvedTarget) && !under(homeEvolve, resolvedTarget)) {
    return {
      ok: false,
      code: "cross_project_evolve",
      message: `evolve write denied: path escapes project evolve root ${homeEvolve}`,
    }
  }

  if (under(memoryRoot, resolvedTarget)) {
    return { ok: true, root: "memory" }
  }
  if (under(homeEvolve, resolvedTarget)) {
    return { ok: true, root: "evolve-home" }
  }
  if (under(projectOimo, resolvedTarget)) {
    // Product source is NEVER under .oimo — but reject writing outside known extension dirs for evolve
    if (input.track === "dream") {
      return {
        ok: false,
        code: "dream_project_oimo",
        message: "dream may only write memory, not project .oimo",
      }
    }
    return { ok: true, root: "project-oimo" }
  }

  return {
    ok: false,
    code: "outside_evolve_sandbox",
    message: `evolve write denied (${input.track}): ${resolvedTarget} is outside memory / .oimo / evolve home`,
  }
}

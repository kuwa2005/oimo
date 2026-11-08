import path from "path"
import fs from "fs/promises"
import { evolveRoot } from "./store"

export type EvolveRootSource = "project" | "global" | "none"

export type ResolvedEvolveRoots = {
  project: string
  global: string
  effective: string
  source: EvolveRootSource
}

async function dirHasArtifacts(root: string): Promise<boolean> {
  const checks = [
    path.join(root, "briefs"),
    path.join(root, "backlog", "BACKLOG.md"),
    path.join(root, "friction"),
    path.join(root, "INDEX.md"),
  ]
  for (const p of checks) {
    const exists = await Bun.file(p).exists().catch(() => false)
    if (exists) return true
    try {
      const st = await fs.stat(p)
      if (st.isDirectory()) {
        const entries = await fs.readdir(p)
        if (entries.some((e) => e.endsWith(".md"))) return true
      }
    } catch {
      continue
    }
  }
  return false
}

export function resolveEvolveRoots(projectID: string): ResolvedEvolveRoots {
  const project = evolveRoot(projectID)
  const global = evolveRoot("global")
  return { project, global, effective: project, source: "none" }
}

export async function resolveEvolveRootsAsync(projectID: string): Promise<ResolvedEvolveRoots> {
  const project = evolveRoot(projectID)
  const global = evolveRoot("global")
  if (projectID === "global") {
    const has = await dirHasArtifacts(global)
    return { project: global, global, effective: global, source: has ? "global" : "none" }
  }
  const [projectHas, globalHas] = await Promise.all([dirHasArtifacts(project), dirHasArtifacts(global)])
  if (projectHas) return { project, global, effective: project, source: "project" }
  if (globalHas) return { project, global, effective: global, source: "global" }
  return { project, global, effective: project, source: "none" }
}

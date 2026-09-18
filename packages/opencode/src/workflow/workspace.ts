import * as fs from "fs"
import path from "path"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { Filesystem } from "@/util"
import { Glob } from "@mimo-ai/shared/util/glob"

/**
 * Multi-root workspace jail: paths must resolve under one of the allowed
 * repository roots (realpath). Single-root callers pass a one-element list.
 */
export function resolveInRoots(roots: string[], rel: string): string {
  const canonicalRoots = roots.map((r) => AppFileSystem.resolve(r))
  const abs = path.isAbsolute(rel) ? AppFileSystem.resolve(rel) : path.resolve(canonicalRoots[0]!, rel)
  const hit = canonicalRoots.find((root) => abs === root || AppFileSystem.contains(root, abs))
  if (!hit) {
    throw new Error(`workspace path escapes allowed repository roots: ${JSON.stringify(rel)}`)
  }
  try {
    const real = fs.realpathSync(abs)
    const still = canonicalRoots.find((root) => real === root || AppFileSystem.contains(root, real))
    if (!still) {
      throw new Error(`workspace path escapes allowed repository roots via symlink: ${JSON.stringify(rel)}`)
    }
    return real
  } catch (err) {
    if (err instanceof Error && err.message.includes("escapes")) throw err
    let parent = path.dirname(abs)
    while (parent !== path.dirname(parent)) {
      try {
        if (!fs.existsSync(parent)) {
          parent = path.dirname(parent)
          continue
        }
        const realParent = fs.realpathSync(parent)
        const still = canonicalRoots.find((root) => realParent === root || AppFileSystem.contains(root, realParent))
        if (!still) {
          throw new Error(`workspace path parent escapes allowed roots: ${JSON.stringify(rel)}`)
        }
        return path.join(realParent, path.relative(parent, abs))
      } catch (inner) {
        if (inner instanceof Error && inner.message.includes("escapes")) throw inner
        parent = path.dirname(parent)
      }
    }
    return abs
  }
}

/** Prefer resolveInRoots for multi-repo. Kept for single-root callers. */
export function resolveInWorkspace(root: string, rel: string): string {
  return resolveInRoots([root], rel)
}

export function makeFileHooks(root: string, opts?: { sessionID?: string }) {
  return makeFileHooksForRoots([root], opts)
}

export function makeFileHooksForRoots(roots: string[], opts?: { sessionID?: string }) {
  return {
    async readFile(rel: unknown): Promise<string | null> {
      const abs = resolveInRoots(roots, String(rel))
      if (!(await Filesystem.exists(abs))) return null
      return Filesystem.readText(abs)
    },
    async writeFile(rel: unknown, content: unknown): Promise<void> {
      const abs = resolveInRoots(roots, String(rel))
      if (opts?.sessionID) {
        const { Runtime, Policy, DirtyBaseline } = await import("@/repo-workspace")
        const info = await Runtime.current()
        if (info) {
          const hit = Policy.decideWrite(info, opts.sessionID, { absolutePath: abs })
          if (!hit.ok) {
            throw new Error(`repo-workspace write denied (${hit.code}): ${hit.message}`)
          }
          const baseline = DirtyBaseline.assertNotTouchingBaseline(
            opts.sessionID,
            hit.repository.id,
            hit.location.relativePath,
          )
          if (!baseline.ok) {
            throw new Error(`repo-workspace write denied (preexisting_dirty): ${baseline.message}`)
          }
        }
      }
      await Filesystem.write(abs, String(content))
    },
    async exists(rel: unknown): Promise<boolean> {
      const abs = resolveInRoots(roots, String(rel))
      return Filesystem.exists(abs)
    },
    async glob(pattern: unknown): Promise<string[]> {
      if (roots.length === 1) {
        const root = roots[0]!
        const abs = await Glob.scan(String(pattern), {
          cwd: root,
          absolute: true,
          include: "all",
          dot: true,
        })
        return abs
          .map((p) => path.relative(root, p))
          .filter((rel) => rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel))
          .sort()
      }
      const all: string[] = []
      for (const root of roots) {
        const abs = await Glob.scan(String(pattern), {
          cwd: root,
          absolute: true,
          include: "all",
          dot: true,
        })
        for (const p of abs) {
          try {
            resolveInRoots(roots, p)
            const repo = path.basename(root)
            all.push(`${repo}:${path.relative(root, p)}`)
          } catch {
            // drop escapes
          }
        }
      }
      return [...new Set(all)].sort()
    },
  }
}

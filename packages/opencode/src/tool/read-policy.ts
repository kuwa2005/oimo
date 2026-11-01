import path from "path"
import { parsePath, type MemoryType } from "@/memory/paths"
import { Instance } from "@/project/instance"

export type ReadPolicyResult = {
  title: string
  output: string
}

const INJECTED_MEMORY_TYPES = new Set<MemoryType>(["memory", "checkpoint", "notes"])

type ReadKey = string

const sessionReads = new Map<string, Map<ReadKey, number>>()

function normalizeAbs(filepath: string) {
  return path.normalize(path.resolve(filepath))
}

function readKey(filepath: string, offset: number, limit: number) {
  return `${filepath}\0${offset}\0${limit}`
}

/** Test hook: clear per-session dedup state. */
export function resetReadPolicySession(sessionID: string) {
  sessionReads.delete(sessionID)
}

function skipOutput(filepath: string, body: string) {
  return [
    `<path>${filepath}</path>`,
    `<type>file</type>`,
    "<content>",
    body,
    "</content>",
  ].join("\n")
}

function memoryArtifactSkip(input: {
  filepath: string
  sessionID: string
  projectID: string
  offset?: number
}): ReadPolicyResult | undefined {
  const filepath = normalizeAbs(input.filepath)
  const locator = parsePath(filepath)
  if (!locator || !INJECTED_MEMORY_TYPES.has(locator.type)) return undefined

  const inScope =
    locator.scope === "global" ||
    (locator.scope === "sessions" && locator.scope_id === input.sessionID) ||
    (locator.scope === "projects" && locator.scope_id === input.projectID)
  if (!inScope) return undefined

  if (input.offset != null && input.offset > 1) return undefined

  return {
    title: path.basename(filepath),
    output: skipOutput(
      filepath,
      [
        "Read skipped (memory dedup): this memory artifact is injected into context on checkpoint rebuild.",
        "Use the checkpoint / memory sections already in your messages, memory.search, or task progress paths.",
        "Re-read only spillover files (checkpoint-<topic>.md) or use offset>1 when you need a specific tail section.",
      ].join("\n"),
    ),
  }
}

function duplicateSourceSkip(input: {
  filepath: string
  sessionID: string
  offset?: number
  limit?: number
}): ReadPolicyResult | undefined {
  const filepath = normalizeAbs(input.filepath)
  if (parsePath(filepath)) return undefined

  const worktree = path.normalize(Instance.directory)
  if (filepath !== worktree && !filepath.startsWith(worktree + path.sep)) return undefined

  const offset = input.offset ?? 1
  const limit = input.limit ?? 2000
  const key = readKey(filepath, offset, limit)
  const counts = sessionReads.get(input.sessionID) ?? new Map<ReadKey, number>()
  sessionReads.set(input.sessionID, counts)
  const next = (counts.get(key) ?? 0) + 1
  counts.set(key, next)
  if (next < 2) return undefined

  const rel = path.relative(worktree, filepath) || filepath
  const skillHint =
    next >= 3
      ? "\nIf this file keeps coming back every session, consider crystallizing patterns in `.oimo/skills/<name>/SKILL.md` (evolve / skills-staging)."
      : ""

  return {
    title: rel,
    output: skipOutput(
      filepath,
      [
        `Read skipped (duplicate): you already read this file in this session (offset=${offset}, limit=${limit}).`,
        "Use prior tool output in the transcript, grep for a symbol, or change offset/limit instead of re-reading the same slice.",
        skillHint.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  }
}

export function evaluateReadPolicy(input: {
  filepath: string
  sessionID: string
  projectID: string
  offset?: number
  limit?: number
}): ReadPolicyResult | undefined {
  return (
    memoryArtifactSkip(input) ??
    duplicateSourceSkip({
      filepath: input.filepath,
      sessionID: input.sessionID,
      offset: input.offset,
      limit: input.limit,
    })
  )
}

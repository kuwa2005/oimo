/**
 * Multi-repo knowledge scope separation (complete-spec §13).
 */
export type KnowledgeKind = "repo" | "workspace" | "user" | "product_brief"

export type KnowledgeTarget = {
  kind: KnowledgeKind
  repositoryID?: string
  workspaceFingerprint?: string
  absolutePathHint?: string
}

export function resolveKnowledgeTarget(input: {
  classification: string
  repositoryID?: string
  workspaceFingerprint?: string
  projectID: string
  worktree: string
  evolveHome: string
}): { ok: true; target: KnowledgeTarget } | { ok: false; message: string } {
  if (input.classification === "hard_evolution_brief" || input.classification === "hard-brief") {
    return {
      ok: true,
      target: {
        kind: "product_brief",
        absolutePathHint: `${input.evolveHome}/briefs`,
      },
    }
  }
  if (input.classification === "workspace_knowledge") {
    if (!input.workspaceFingerprint) {
      return { ok: false, message: "workspace_knowledge requires workspaceFingerprint" }
    }
    return {
      ok: true,
      target: {
        kind: "workspace",
        workspaceFingerprint: input.workspaceFingerprint,
        absolutePathHint: `${input.worktree}/.oimo/memory-workspace`,
      },
    }
  }
  if (input.classification === "durable_fact" || input.classification === "project_procedure") {
    if (input.repositoryID) {
      return {
        ok: true,
        target: {
          kind: "repo",
          repositoryID: input.repositoryID,
          absolutePathHint: `${input.worktree}/.oimo/memory`,
        },
      }
    }
    return {
      ok: true,
      target: {
        kind: "user",
        absolutePathHint: `${input.worktree}/.oimo/memory`,
      },
    }
  }
  return {
    ok: true,
    target: {
      kind: "repo",
      repositoryID: input.repositoryID,
      absolutePathHint: `${input.worktree}/.oimo`,
    },
  }
}

/** Refuse applying repo-scoped knowledge to a different repository. */
export function assertKnowledgeApplies(input: {
  entryRepositoryID?: string
  targetRepositoryID?: string
  entryKind: KnowledgeKind
}) {
  if (input.entryKind !== "repo") return { ok: true as const }
  if (!input.entryRepositoryID) return { ok: true as const }
  if (input.targetRepositoryID && input.entryRepositoryID !== input.targetRepositoryID) {
    return {
      ok: false as const,
      message: `repo knowledge for "${input.entryRepositoryID}" cannot apply to "${input.targetRepositoryID}"`,
    }
  }
  return { ok: true as const }
}

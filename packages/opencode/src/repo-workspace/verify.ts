import path from "path"
import type { Info } from "./schema"
import type { VerificationSummary } from "./change-set"
import { rootOf } from "./resolve"

export type DetectedCommand = {
  name: string
  command: string
  source: "package.json" | "heuristic"
}

/**
 * Detect verify commands for a repository. Does not run them.
 * Missing scripts → not treated as success later (status not_run / skipped with reason).
 */
export async function detectVerifyCommands(info: Info, repositoryId: string): Promise<DetectedCommand[]> {
  const repo = rootOf(info, repositoryId)
  const root = repo.canonicalPath
  const pkgPath = path.join(root, "package.json")
  if (await Bun.file(pkgPath).exists()) {
    const pkg = (await Bun.file(pkgPath).json()) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}
    const out: DetectedCommand[] = []
    const prefer = ["typecheck", "lint", "test", "build", "check", "format"]
    for (const name of prefer) {
      if (scripts[name]) out.push({ name, command: `bun run ${name}`, source: "package.json" })
    }
    if (!out.length && scripts["test"]) {
      out.push({ name: "test", command: `bun run test`, source: "package.json" })
    }
    return out
  }

  const heuristic: DetectedCommand[] = []
  if (await Bun.file(path.join(root, "Cargo.toml")).exists()) {
    heuristic.push({ name: "test", command: "cargo test", source: "heuristic" })
    heuristic.push({ name: "build", command: "cargo check", source: "heuristic" })
  }
  if (await Bun.file(path.join(root, "go.mod")).exists()) {
    heuristic.push({ name: "test", command: "go test ./...", source: "heuristic" })
  }
  if (await Bun.file(path.join(root, "pyproject.toml")).exists() || (await Bun.file(path.join(root, "pytest.ini")).exists())) {
    heuristic.push({ name: "test", command: "pytest", source: "heuristic" })
  }
  if (await Bun.file(path.join(root, "Makefile")).exists()) {
    heuristic.push({ name: "test", command: "make test", source: "heuristic" })
  }
  return heuristic
}

/**
 * Run detected commands with cwd = repository root (never `cd &&` string concat as the primary API).
 * Failed or skipped commands never become "passed".
 */
export async function runVerify(input: {
  info: Info
  repositoryId: string
  commands?: DetectedCommand[]
  /** Dependency order: skip run if earlier repos failed — caller decides. */
  dryRun?: boolean
  /** When set, mark all commands skipped with this reason (no spawn). */
  skipReason?: string
}): Promise<VerificationSummary> {
  const repo = rootOf(input.info, input.repositoryId)
  const commands = input.commands ?? (await detectVerifyCommands(input.info, input.repositoryId))
  if (input.skipReason) {
    return {
      commands: (commands.length ? commands : [{ name: "verify", command: "(none)", source: "heuristic" as const }]).map(
        (cmd) => ({
          name: cmd.name,
          command: cmd.command,
          cwd: repo.canonicalPath,
          status: "skipped" as const,
          reason: input.skipReason,
        }),
      ),
    }
  }
  if (!commands.length) {
    return {
      commands: [
        {
          name: "verify",
          command: "(none detected)",
          cwd: repo.canonicalPath,
          status: "skipped",
          reason: "No package.json scripts for typecheck/lint/test/build",
        },
      ],
    }
  }

  const results: VerificationSummary["commands"] = []
  for (const cmd of commands) {
    if (input.dryRun) {
      results.push({
        name: cmd.name,
        command: cmd.command,
        cwd: repo.canonicalPath,
        status: "not_run",
        reason: "dry-run",
      })
      continue
    }
    const proc = Bun.spawn(["bash", "-lc", cmd.command], {
      cwd: repo.canonicalPath,
      stdout: "pipe",
      stderr: "pipe",
    })
    const exitCode = await proc.exited
    results.push({
      name: cmd.name,
      command: cmd.command,
      cwd: repo.canonicalPath,
      status: exitCode === 0 ? "passed" : "failed",
      exitCode,
      reason: exitCode === 0 ? undefined : `exit ${exitCode}`,
    })
  }
  return { commands: results }
}

/** Run verify in dependency order; upstream failure skips downstream as dependency_failed. */
export async function runVerifyOrdered(input: {
  info: Info
  repositoryIds: string[]
  dryRun?: boolean
}): Promise<Array<{ repositoryId: string; verification: VerificationSummary }>> {
  const rows: Array<{ repositoryId: string; verification: VerificationSummary }> = []
  let blocked = false
  for (const repositoryId of input.repositoryIds) {
    if (blocked) {
      rows.push({
        repositoryId,
        verification: await runVerify({
          info: input.info,
          repositoryId,
          dryRun: input.dryRun,
          skipReason: "dependency_failed",
        }),
      })
      continue
    }
    const verification = await runVerify({
      info: input.info,
      repositoryId,
      dryRun: input.dryRun,
    })
    rows.push({ repositoryId, verification })
    if (verification.commands.some((c) => c.status === "failed")) blocked = true
  }
  return rows
}

export function aggregateVerification(
  byRepo: Array<{ repositoryId: string; verification: VerificationSummary }>,
): {
  ok: boolean
  failed: string[]
  skipped: string[]
  summary: string
} {
  const failed: string[] = []
  const skipped: string[] = []
  for (const row of byRepo) {
    for (const c of row.verification.commands) {
      if (c.status === "failed") failed.push(`${row.repositoryId}:${c.name}`)
      if (c.status === "skipped" || c.status === "not_run") skipped.push(`${row.repositoryId}:${c.name}`)
    }
  }
  const ok = failed.length === 0 && byRepo.every((r) => r.verification.commands.some((c) => c.status === "passed"))
  // Explicit: all-skipped is NOT success
  const onlySkipped =
    failed.length === 0 && byRepo.every((r) => r.verification.commands.every((c) => c.status !== "passed"))
  return {
    ok: ok && !onlySkipped,
    failed,
    skipped,
    summary: [
      `repos=${byRepo.length}`,
      failed.length ? `failed: ${failed.join(", ")}` : "failed: (none)",
      skipped.length ? `skipped/not_run: ${skipped.join(", ")}` : "skipped: (none)",
      onlySkipped ? "OVERALL: not successful (no tests executed)" : ok ? "OVERALL: passed" : "OVERALL: failed",
    ].join("\n"),
  }
}

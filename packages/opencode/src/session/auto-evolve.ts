import { Effect } from "effect"
import { isMemoryWriteEnabled } from "@/memory/write-gate"
import { Database, eq, desc, asc, isNull, and } from "@/storage"
import { SessionTable } from "./session.sql"
import { Log } from "@/util"
import type { Config } from "@/config"
import { InstanceState } from "@/effect"
import { evaluateConditionTriggers } from "@/evolve/triggers"
import * as EvolutionScheduler from "@/evolve/scheduler"
import { assertRawTrajectoryConsent, isEvolutionPaused, loadConsent } from "@/evolve/retention"

const log = Log.create({ service: "auto-evolve" })

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_EVOLVE_INTERVAL_DAYS = 14
const MIN_CONDITION_GAP_MS = 60 * 60 * 1000

export const AUTO_EVOLVE_TITLE = "Auto Evolve"

/** Complete-spec default: opt-in. Explicit `evolve.auto: true` enables. */
export function evolveAutoEnabled(cfg: Config.Info): boolean {
  if (isEvolutionPaused(cfg)) return false
  if (cfg.evolution?.enabled === false) return false
  if (cfg.evolution?.soft?.auto_generate === true || cfg.evolution?.hard?.auto_generate_briefs === true) {
    return true
  }
  return cfg.evolve?.auto === true
}

export function evolveSkillsEnabled(cfg: Config.Info): boolean {
  return cfg.evolve?.skills?.enabled !== false
}

export function evolveBriefsEnabled(cfg: Config.Info): boolean {
  if (cfg.evolution?.hard?.auto_generate_briefs === false) return false
  return cfg.evolve?.briefs?.enabled !== false
}

export function evolveFrictionEnabled(cfg: Config.Info): boolean {
  return cfg.evolve?.friction?.enabled !== false
}

export function evolveBacklogEnabled(cfg: Config.Info): boolean {
  return cfg.evolve?.backlog?.enabled !== false
}

export function evolveSessionReviewEnabled(cfg: Config.Info): boolean {
  return cfg.evolve?.session_review?.enabled !== false
}

export function buildEvolveTask(input: {
  skills: boolean
  briefs: boolean
  friction: boolean
  backlog: boolean
  sessionReview: boolean
  manual?: boolean
  arguments?: string
  triggerReasons?: string[]
}): string {
  const mode = input.manual ? "manual" : "automatic"
  const tracks = [
    `Track A (skill knowledge base): ${input.skills ? "ENABLED" : "DISABLED"}`,
    `Track B (product modification briefs for external coding agents): ${input.briefs ? "ENABLED" : "DISABLED"}`,
    `Track C (friction / Human Attention Cost analysis): ${input.friction ? "ENABLED" : "DISABLED"}`,
    `Track D (self-improvement backlog): ${input.backlog ? "ENABLED" : "DISABLED"}`,
    `Track E (session self-evaluation reviews): ${input.sessionReview ? "ENABLED" : "DISABLED"}`,
  ]
  const lines = [
    `Run one ${mode} Self Improvement Session (evolve pass) for the current project.`,
    "",
    "This is the closed Observe→Analyze→Propose loop. Do not modify oimo product source;",
    "write proposals for the user to review and hand to an external coding agent.",
    "",
    "Start with the `evolve_status` tool: snapshot (before writes), metrics, then dashboard.",
    "Use evolve_status scenarios / scenario_prompt / scenario_observe for friction regressions (DB traces, not self-report).",
    "Use evolve_status gate to combine friction + scenario results before recommending adopt.",
    "Use evolve_status handoffs to list pending hard briefs for human / external-agent delivery.",
    "After briefs: suggest workflow evolve-review, then (only with explicit user approval) evolve-apply { approved: true, brief_hash }.",
    "",
    "Tracks for this run:",
    ...tracks.map((t) => `- ${t}`),
    "",
    "Use the memory files as the working index and the redacted Evidence API / trajectory as sources.",
    "Never copy secrets, tokens, or credentials into briefs or skills.",
    "Inventory existing project `.oimo/skills` and `~/.oimo/evolve/<projectID>/` assets first; prefer extend over duplicate.",
    "Write skills under `<worktree>/.oimo/skills-staging/` then activate after validation.",
    "Write self-evolution logs under `~/.oimo/evolve/<projectID>/`:",
    "  briefs/, friction/, backlog/BACKLOG.md, reviews/, INDEX.md, history/HISTORY.md, scenarios/, snapshots/.",
    "Quantify bottlenecks (tool churn, re-reads, corrections, Human Attention Cost) before proposing.",
    "Classify each item as skill/project-local vs oimo-product before choosing the route.",
    "Use bash for read-only SQLite and filesystem inspection. Do not modify the database.",
    "Produce only high-confidence artifacts. Doing nothing is a valid success.",
  ]
  if (input.triggerReasons?.length) {
    lines.push("", "Auto-trigger reasons:", ...input.triggerReasons.map((r) => `- ${r}`))
  }
  if (input.manual && input.arguments?.trim()) {
    lines.push("", "User focus or constraints:", input.arguments.trim())
  }
  return lines.join("\n")
}

export const EVOLVE_TASK = buildEvolveTask({
  skills: true,
  briefs: true,
  friction: true,
  backlog: true,
  sessionReview: true,
})

function shouldAutoRun(input: {
  enabled: boolean
  intervalDays: number
  title: string
  label: string
  projectID: string
}) {
  return Effect.gen(function* () {
    if (!input.enabled) return false

    const intervalMs = input.intervalDays * DAY_MS

    // Prefer durable project-scoped scheduler (complete-spec §12)
    const dueSched = EvolutionScheduler.isDue({
      projectID: input.projectID,
      track: "evolve",
      intervalMs,
    })
    if (!dueSched.due && dueSched.reason === "lease_held") {
      log.info(`auto-${input.label} skipped — lease held`, { projectID: input.projectID })
      return false
    }
    if (!dueSched.due && dueSched.reason === "cooldown") {
      log.info(`auto-${input.label} skipped — scheduler cooldown`, {
        projectID: input.projectID,
        lastRunAgo: dueSched.lastRunMs ? Math.round((Date.now() - dueSched.lastRunMs) / DAY_MS) + "d" : "?",
      })
      return false
    }

    // Project-scoped session title lookup (never cross-project)
    const lastRun = yield* Effect.sync(() =>
      Database.use((db) =>
        db
          .select({ time_created: SessionTable.time_created })
          .from(SessionTable)
          .where(and(eq(SessionTable.title, input.title), eq(SessionTable.project_id, input.projectID as never)))
          .orderBy(desc(SessionTable.time_created))
          .limit(1)
          .get(),
      ),
    )

    const now = Date.now()
    const elapsed = lastRun ? now - lastRun.time_created : Infinity

    if (!lastRun && dueSched.lastRunMs == null) {
      const earliest = yield* Effect.sync(() =>
        Database.use((db) =>
          db
            .select({ time_created: SessionTable.time_created })
            .from(SessionTable)
            .where(and(isNull(SessionTable.parent_id), eq(SessionTable.project_id, input.projectID as never)))
            .orderBy(asc(SessionTable.time_created))
            .limit(1)
            .get(),
        ),
      )
      if (!earliest || now - earliest.time_created < intervalMs) {
        log.info(`auto-${input.label} skipped — project too young`, {
          projectID: input.projectID,
          projectAge: earliest ? Math.round((now - earliest.time_created) / DAY_MS) + "d" : "empty",
          interval: input.intervalDays + "d",
        })
        return false
      }
    }

    if (elapsed < intervalMs && dueSched.lastRunMs == null) {
      log.info(`auto-${input.label} skipped — last run too recent`, {
        projectID: input.projectID,
        lastRunAgo: Math.round(elapsed / DAY_MS) + "d",
        interval: input.intervalDays + "d",
      })
      return false
    }

    log.info(`auto-${input.label} triggering`, {
      projectID: input.projectID,
      lastRun: lastRun ? new Date(lastRun.time_created).toISOString() : "never",
      interval: input.intervalDays + "d",
    })
    return true
  })
}

export function shouldAutoEvolve(cfg: Config.Info) {
  return Effect.gen(function* () {
    if (!isMemoryWriteEnabled(cfg)) return false
    if (!evolveAutoEnabled(cfg)) return false

    const ctx = yield* InstanceState.context
    const projectID = String(ctx.project.id)
    const consent = yield* Effect.promise(() => loadConsent(projectID))
    const consentOk = assertRawTrajectoryConsent(consent, "automatic")
    if (!consentOk.ok) {
      log.info("auto-evolve skipped — missing raw trajectory consent", { projectID })
      return false
    }

    const intervalDays = cfg.evolve?.interval_days ?? DEFAULT_EVOLVE_INTERVAL_DAYS

    const lease = EvolutionScheduler.tryAcquireLease({
      projectID,
      track: "evolve",
      ttlMs: MIN_CONDITION_GAP_MS,
    })
    if (!lease.ok) return false

    const due = yield* shouldAutoRun({
      enabled: true,
      intervalDays,
      title: AUTO_EVOLVE_TITLE,
      label: "evolve",
      projectID,
    })
    if (due) {
      EvolutionScheduler.recordRun(projectID, "evolve")
      return true
    }

    if (cfg.evolve?.condition_triggers === false) {
      EvolutionScheduler.releaseLease(projectID, "evolve", lease.owner)
      return false
    }

    const last = EvolutionScheduler.getSchedulerRow(projectID, "evolve")
    if (last?.last_run_ms && Date.now() - last.last_run_ms < MIN_CONDITION_GAP_MS) {
      EvolutionScheduler.releaseLease(projectID, "evolve", lease.owner)
      return false
    }

    const decision = yield* Effect.sync(() => evaluateConditionTriggers({ projectID: ctx.project.id, windowDays: 7 }))
    if (!decision.fire) {
      EvolutionScheduler.releaseLease(projectID, "evolve", lease.owner)
      return false
    }

    log.info("auto-evolve triggering — condition", { projectID, reasons: decision.reasons })
    EvolutionScheduler.recordRun(projectID, "evolve")
    return true
  })
}

export function evolveTaskForConfig(
  cfg: Config.Info,
  input?: { manual?: boolean; arguments?: string; triggerReasons?: string[] },
) {
  return buildEvolveTask({
    skills: evolveSkillsEnabled(cfg),
    briefs: evolveBriefsEnabled(cfg),
    friction: evolveFrictionEnabled(cfg),
    backlog: evolveBacklogEnabled(cfg),
    sessionReview: evolveSessionReviewEnabled(cfg),
    manual: input?.manual,
    arguments: input?.arguments,
    triggerReasons: input?.triggerReasons,
  })
}

export * as AutoEvolve from "./auto-evolve"

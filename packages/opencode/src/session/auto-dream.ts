import { Effect } from "effect"
import { isMemoryWriteEnabled } from "@/memory/write-gate"
import { Database, eq, desc, asc, isNull, and } from "@/storage"
import { SessionTable } from "./session.sql"
import { Log } from "@/util"
import type { Config } from "@/config"
import { AUTO_EVOLVE_TITLE } from "./auto-evolve"
import { InstanceState } from "@/effect"
import * as EvolutionScheduler from "@/evolve/scheduler"
import { isEvolutionPaused } from "@/evolve/retention"

const log = Log.create({ service: "auto-dream" })

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_DREAM_INTERVAL_DAYS = 7
const DEFAULT_DISTILL_INTERVAL_DAYS = 30

export const AUTO_DREAM_TITLE = "Auto Dream"
export const AUTO_DISTILL_TITLE = "Auto Distill"

const SYSTEM_SESSION_TITLES: ReadonlySet<string> = new Set([
  AUTO_DREAM_TITLE,
  AUTO_DISTILL_TITLE,
  AUTO_EVOLVE_TITLE,
])

export function isSystemSession(session: { title: string }): boolean {
  return SYSTEM_SESSION_TITLES.has(session.title)
}

export const DREAM_TASK = [
  "Run one automatic dream memory consolidation pass for the current project.",
  "",
  "Use the memory files as the working index and the raw oimo trajectory database as the source of truth.",
  "Use bash for read-only SQLite and filesystem inspection. Do not modify the database.",
  "Consolidate only durable, verified information into project memory.",
  "Write provenance sidecars (evidenceIDs, confidence, scope) for new durable facts; refuse volatile facts.",
  "Never copy secrets or credentials into memory.",
].join("\n")

export const DISTILL_TASK = [
  "Run one automatic distill pass for the current project.",
  "",
  "Review the past month of sessions and identify repeated manual workflows worth packaging.",
  "Use the raw oimo trajectory database as the source of truth and memory files to spot cross-session patterns.",
  "Inventory existing skills, agents, and commands first so you reuse or extend instead of duplicating.",
  "Use bash for read-only SQLite and filesystem inspection. Do not modify the database.",
  "Produce a compact shortlist, then create only the high-confidence missing assets.",
  "Write new skills under .oimo/skills-staging/<name>/ first; activate only after validation.",
].join("\n")

function shouldAutoRun(input: {
  enabled: boolean
  intervalDays: number
  title: string
  label: string
  projectID: string
  track: "dream" | "distill"
}) {
  return Effect.gen(function* () {
    if (!input.enabled) return false

    const intervalMs = input.intervalDays * DAY_MS
    const dueSched = EvolutionScheduler.isDue({
      projectID: input.projectID,
      track: input.track,
      intervalMs,
    })
    if (!dueSched.due) {
      log.info(`auto-${input.label} skipped — ${dueSched.reason ?? "not due"}`, {
        projectID: input.projectID,
      })
      return false
    }

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
    EvolutionScheduler.recordRun(input.projectID, input.track)
    return true
  })
}

export function shouldAutoDream(cfg: Config.Info) {
  return Effect.gen(function* () {
    if (!isMemoryWriteEnabled(cfg)) return false
    if (isEvolutionPaused(cfg)) return false
    const enabled = cfg.dream?.auto === true || cfg.evolution?.soft?.auto_generate === true
    if (!enabled) return false
    const ctx = yield* InstanceState.context
    const intervalDays = cfg.dream?.interval_days ?? DEFAULT_DREAM_INTERVAL_DAYS
    return yield* shouldAutoRun({
      enabled: true,
      intervalDays,
      title: AUTO_DREAM_TITLE,
      label: "dream",
      projectID: String(ctx.project.id),
      track: "dream",
    })
  })
}

export function shouldAutoDistill(cfg: Config.Info) {
  return Effect.gen(function* () {
    if (!isMemoryWriteEnabled(cfg)) return false
    if (isEvolutionPaused(cfg)) return false
    const enabled = cfg.distill?.auto === true || cfg.evolution?.soft?.auto_generate === true
    if (!enabled) return false
    const ctx = yield* InstanceState.context
    const intervalDays = cfg.distill?.interval_days ?? DEFAULT_DISTILL_INTERVAL_DAYS
    return yield* shouldAutoRun({
      enabled: true,
      intervalDays,
      title: AUTO_DISTILL_TITLE,
      label: "distill",
      projectID: String(ctx.project.id),
      track: "distill",
    })
  })
}

export * as AutoDream from "./auto-dream"

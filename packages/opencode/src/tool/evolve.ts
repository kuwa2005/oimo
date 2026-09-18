import { Effect } from "effect"
import z from "zod"
import { InstanceState } from "@/effect"
import { collectFrictionMetrics, formatFrictionMetrics } from "@/evolve/metrics"
import { formatDashboard, loadDashboard } from "@/evolve/store"
import { createSnapshot, listSnapshots, rollbackSnapshot } from "@/evolve/rollback"
import { compareFriction, combineGate, formatEval, formatGate } from "@/evolve/evaluate"
import {
  formatScenarioList,
  getScenario,
  listScenarios,
  scenarioRunPrompt,
  scoreObservation,
} from "@/evolve/scenarios"
import type { ScenarioObservation } from "@/evolve/scenario"
import { observeFromDatabase } from "@/evolve/observe-trace"
import { formatPendingHandoffs, listPendingHandoffs } from "@/evolve/handoff"
import {
  deleteProjectEvolution,
  loadConsent,
  recordConsent,
} from "@/evolve/retention"
import DESCRIPTION from "./evolve.txt"
import * as Tool from "./tool"

const parameters = z.object({
  operation: z
    .enum([
      "metrics",
      "dashboard",
      "snapshot",
      "list_snapshots",
      "rollback",
      "evaluate",
      "scenarios",
      "scenario_prompt",
      "scenario_score",
      "scenario_observe",
      "handoffs",
      "consent",
      "delete_artifacts",
      "gate",
    ])
    .describe("Evolve tooling operation"),
  window_days: z.number().optional().describe("Metrics window in days (default 14)"),
  before_days: z.number().optional().describe("evaluate: older window size"),
  after_days: z.number().optional().describe("evaluate: recent window size"),
  label: z.string().optional().describe("snapshot label suffix"),
  snapshot_id: z.string().optional().describe("rollback: snapshot id"),
  scenario_id: z.string().optional().describe("scenario_prompt / scenario_score / gate / scenario_observe"),
  session_id: z.string().optional().describe("scenario_observe: restrict to one session"),
  raw_trajectory_opt_in: z.boolean().optional().describe("consent: allow automatic raw trajectory analysis"),
  confirm_delete: z.boolean().optional().describe("delete_artifacts: must be true to wipe project evolve root"),
  observation: z
    .object({
      userClarifications: z.number(),
      toolCalls: z.number(),
      sameFileReads: z.number(),
      corrections: z.number(),
      skillsUsed: z.array(z.string()),
      askedUserFor: z.array(z.string()),
    })
    .optional()
    .describe("scenario_score / gate: observed behavior (prefer scenario_observe from DB)"),
})

export const EvolveTool = Tool.define(
  "evolve_status",
  Effect.succeed({
    description: DESCRIPTION,
    parameters,
    execute: (args: z.infer<typeof parameters>, _ctx: Tool.Context) =>
      Effect.gen(function* () {
        const ctx = yield* InstanceState.context
        const projectID = ctx.project.id
        const worktree = ctx.worktree

        if (args.operation === "metrics") {
          const m = collectFrictionMetrics({ projectID, windowDays: args.window_days ?? 14 })
          return {
            title: `Evolve metrics (${m.windowDays}d)`,
            output: formatFrictionMetrics(m),
            metadata: { operation: "metrics" },
          }
        }

        if (args.operation === "dashboard") {
          const d = yield* Effect.promise(() => loadDashboard({ projectID, worktree }))
          return {
            title: "Evolve dashboard",
            output: formatDashboard(d),
            metadata: { operation: "dashboard" },
          }
        }

        if (args.operation === "snapshot") {
          const snap = yield* Effect.promise(() => createSnapshot({ projectID, worktree }, args.label))
          return {
            title: `Snapshot ${snap.id}`,
            output: [
              `Created snapshot ${snap.id}`,
              `Path: ${snap.path}`,
              `Targets: ${snap.targets.join(", ") || "(empty)"}`,
            ].join("\n"),
            metadata: { operation: "snapshot", id: snap.id },
          }
        }

        if (args.operation === "list_snapshots") {
          const list = yield* Effect.promise(() => listSnapshots(projectID))
          return {
            title: `Snapshots: ${list.length}`,
            output:
              list.length === 0
                ? "No snapshots yet. Call operation=snapshot before evolving."
                : list.map((s) => `- ${s.id}  targets=[${s.targets.join(",")}]  ${s.createdAt}`).join("\n"),
            metadata: { operation: "list_snapshots", count: list.length },
          }
        }

        if (args.operation === "rollback") {
          if (!args.snapshot_id) {
            return {
              title: "Rollback: missing snapshot_id",
              output: "operation=rollback requires snapshot_id",
              metadata: { operation: "rollback" },
            }
          }
          const restored = yield* Effect.promise(() =>
            rollbackSnapshot({ projectID, worktree }, args.snapshot_id!),
          )
          return {
            title: `Rolled back to ${restored.id}`,
            output: [
              `Restored snapshot ${restored.id}`,
              `Targets: ${restored.targets.join(", ")}`,
              `A pre-rollback safety snapshot was also created.`,
            ].join("\n"),
            metadata: { operation: "rollback", id: restored.id },
          }
        }

        if (args.operation === "scenarios") {
          const fixtures = yield* Effect.promise(() => listScenarios(projectID))
          return {
            title: `Scenarios: ${fixtures.length}`,
            output: formatScenarioList(fixtures),
            metadata: { operation: "scenarios", count: fixtures.length },
          }
        }

        if (args.operation === "scenario_prompt") {
          if (!args.scenario_id) {
            return {
              title: "scenario_prompt: missing scenario_id",
              output: "Pass scenario_id from operation=scenarios",
              metadata: { operation: "scenario_prompt" },
            }
          }
          const fixtures = yield* Effect.promise(() => listScenarios(projectID))
          const fixture = getScenario(fixtures, args.scenario_id)
          if (!fixture) {
            return {
              title: "scenario not found",
              output: `Unknown scenario_id: ${args.scenario_id}`,
              metadata: { operation: "scenario_prompt" },
            }
          }
          return {
            title: `Scenario prompt: ${fixture.id}`,
            output: scenarioRunPrompt(fixture),
            metadata: { operation: "scenario_prompt", id: fixture.id },
          }
        }

        if (args.operation === "scenario_score") {
          if (!args.scenario_id || !args.observation) {
            return {
              title: "scenario_score: missing args",
              output:
                "Requires scenario_id and observation. Prefer operation=scenario_observe to build observation from DB traces.",
              metadata: { operation: "scenario_score" },
            }
          }
          const fixtures = yield* Effect.promise(() => listScenarios(projectID))
          const fixture = getScenario(fixtures, args.scenario_id)
          if (!fixture) {
            return {
              title: "scenario not found",
              output: `Unknown scenario_id: ${args.scenario_id}`,
              metadata: { operation: "scenario_score" },
            }
          }
          const score = scoreObservation(fixture, args.observation as ScenarioObservation)
          return {
            title: score.pass ? `PASS ${score.id}` : `FAIL ${score.id}`,
            output: [
              score.pass ? "PASS" : "FAIL",
              ...score.failures.map((f) => `- ${f}`),
              "",
              "```json",
              JSON.stringify(score, null, 2),
              "```",
            ].join("\n"),
            metadata: { operation: "scenario_score", pass: score.pass, id: score.id },
          }
        }

        if (args.operation === "scenario_observe") {
          if (!args.scenario_id) {
            return {
              title: "scenario_observe: missing scenario_id",
              output: "Pass scenario_id; observation is computed from SQLite traces (not self-report).",
              metadata: { operation: "scenario_observe" },
            }
          }
          const fixtures = yield* Effect.promise(() => listScenarios(projectID))
          const fixture = getScenario(fixtures, args.scenario_id)
          if (!fixture) {
            return {
              title: "scenario not found",
              output: `Unknown scenario_id: ${args.scenario_id}`,
              metadata: { operation: "scenario_observe" },
            }
          }
          const windowDays = args.window_days ?? 14
          const obs = observeFromDatabase({
            projectID,
            sessionID: args.session_id,
            cutoffMs: Date.now() - windowDays * 86400000,
          })
          const score = scoreObservation(fixture, obs)
          return {
            title: score.pass ? `PASS ${score.id} (from DB)` : `FAIL ${score.id} (from DB)`,
            output: [
              "Observation source: SQLite trajectory (not model self-report)",
              score.pass ? "PASS" : "FAIL",
              ...score.failures.map((f) => `- ${f}`),
              "",
              "```json",
              JSON.stringify({ observation: obs, score }, null, 2),
              "```",
            ].join("\n"),
            metadata: {
              operation: "scenario_observe",
              pass: score.pass,
              id: score.id,
              source: "database",
            },
          }
        }

        if (args.operation === "handoffs") {
          const items = yield* Effect.promise(() => listPendingHandoffs(projectID))
          return {
            title: `Handoffs: ${items.length}`,
            output: formatPendingHandoffs(items),
            metadata: { operation: "handoffs", count: items.length },
          }
        }

        if (args.operation === "consent") {
          if (args.raw_trajectory_opt_in === undefined) {
            const existing = yield* Effect.promise(() => loadConsent(projectID))
            return {
              title: "Consent status",
              output: existing
                ? JSON.stringify(existing, null, 2)
                : "No consent recorded. Pass raw_trajectory_opt_in=true|false to record.",
              metadata: { operation: "consent", recorded: Boolean(existing) },
            }
          }
          const saved = yield* Effect.promise(() =>
            recordConsent(projectID, {
              version: 1,
              rawTrajectoryOptIn: args.raw_trajectory_opt_in === true,
              autoDream: false,
              autoDistill: false,
              autoSoftGenerate: false,
              autoHardBrief: false,
            }),
          )
          return {
            title: "Consent recorded",
            output: JSON.stringify(saved, null, 2),
            metadata: { operation: "consent", recorded: true },
          }
        }

        if (args.operation === "delete_artifacts") {
          if (args.confirm_delete !== true) {
            return {
              title: "delete_artifacts: refused",
              output: "Pass confirm_delete=true to wipe ~/.oimo/evolve/<projectID>/",
              metadata: { operation: "delete_artifacts", deleted: false },
            }
          }
          const wiped = yield* Effect.promise(() => deleteProjectEvolution(projectID))
          return {
            title: "Evolution artifacts deleted",
            output: `Removed ${wiped.root}`,
            metadata: { operation: "delete_artifacts", deleted: true, root: wiped.root },
          }
        }

        if (args.operation === "gate") {
          const afterDays = args.after_days ?? args.window_days ?? 7
          const beforeDays = args.before_days ?? afterDays
          const after = collectFrictionMetrics({ projectID, windowDays: afterDays })
          const baseline = collectFrictionMetrics({ projectID, windowDays: beforeDays + afterDays })
          const friction = compareFriction(baseline, after)

          const fixtures = yield* Effect.promise(() => listScenarios(projectID))
          const scenarioScores =
            args.scenario_id && args.observation
              ? (() => {
                  const fixture = getScenario(fixtures, args.scenario_id!)
                  return fixture ? [scoreObservation(fixture, args.observation as ScenarioObservation)] : []
                })()
              : undefined

          const gate = combineGate({ friction, scenarios: scenarioScores })
          return {
            title: `Gate: ${gate.verdict}`,
            output: [formatGate(gate), "", formatEval(friction)].join("\n"),
            metadata: { operation: "gate", verdict: gate.verdict },
          }
        }

        // evaluate (friction-only, kept for compatibility)
        const afterDays = args.after_days ?? args.window_days ?? 7
        const beforeDays = args.before_days ?? afterDays
        const after = collectFrictionMetrics({ projectID, windowDays: afterDays })
        const baseline = collectFrictionMetrics({ projectID, windowDays: beforeDays + afterDays })
        const cmp = compareFriction(baseline, after)
        return {
          title: `Evaluate: ${cmp.verdict}`,
          output: [
            formatEval(cmp),
            "",
            `Note: baseline≈last ${beforeDays + afterDays}d vs recent≈last ${afterDays}d (coarse gate).`,
            `Prefer operation=gate to include scenario fixtures.`,
          ].join("\n"),
          metadata: { operation: "evaluate", verdict: cmp.verdict },
        }
      }).pipe(Effect.map((result) => ({ ...result, metadata: result.metadata as Record<string, unknown> }))),
  }),
)

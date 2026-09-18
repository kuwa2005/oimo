import { Effect, Layer, Context, Option } from "effect"
import { generateObject, streamObject, type ModelMessage } from "ai"
import z from "zod"
import * as OtelTracer from "@effect/opentelemetry/Tracer"
import { InstanceState } from "@/effect"
import { EffectLogger } from "@/effect"
import { Provider, ProviderTransform } from "@/provider"
import type { ProviderID, ModelID } from "@/provider/schema"
import { Auth } from "@/auth"
import { Config } from "@/config"
import * as ConfigAutonomy from "@/config/autonomy"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Session } from "@/session"
import { SessionID } from "./schema"
import { MessageV2 } from "./message-v2"
import { AutonomyBridge } from "@/autonomy/bridge"
import { getLatestRunForSession } from "@/autonomy/run"
import type { GoalPhase } from "./goal-ref"
import { canonicalizeGoalPhase } from "./goal-ref"

export type { GoalPhase }
export { isHearingLike, isExecuteLike, canonicalizeGoalPhase } from "./goal-ref"

/**
 * Per-session stop-condition goal. `/goal` or autonomy mode: once a goal
 * is set, the main runLoop refuses to stop until an independent judge model
 * decides the condition is satisfied (or genuinely impossible). The judge is a
 * separate model call that only reads the transcript — it does not do the work,
 * so its verdict stays cold relative to the working agent's optimism.
 *
 * State lives in InstanceState (per project instance), keyed by sessionID, and
 * is cleared on instance teardown. See run-state.ts for the sibling pattern.
 */

export type GoalStopReason =
  | "completed"
  | "impossible"
  | "cancelled"
  | "waiting_user"
  | "budget_turns"
  | "budget_duration"
  | "budget_cost"
  | "judge_failed"

export type Goal = {
  condition: string
  /** Number of judge-driven re-entries so far. */
  react: number
  startedAt: number
  startMessageID?: string
  costUsd: number
  maxTurns: number
  maxDurationMs: number
  maxCostUsd: number
  judgeMaxRetries: number
  judgeFailures: number
  autonomous: boolean
  /** AutonomyPhase — discover/lock_pending/…; not a parallel hearing|execute enum. */
  phase: GoalPhase
  stopReason?: GoalStopReason
  /** Multi-repo binding — required together for safe resume. */
  workspaceFingerprint?: string
  changeSetID?: string
  executionScope?: string[]
  evidenceManifestPath?: string
}

export const Verdict = z.object({
  ok: z.boolean(),
  impossible: z.boolean().optional(),
  reason: z.string(),
})
export type Verdict = z.infer<typeof Verdict>

const GoalView = z.object({
  condition: z.string(),
  react: z.number().optional(),
  startedAt: z.number().optional(),
  costUsd: z.number().optional(),
  maxTurns: z.number().optional(),
  maxDurationMs: z.number().optional(),
  maxCostUsd: z.number().optional(),
  autonomous: z.boolean().optional(),
  phase: z
    .enum([
      "discover",
      "lock_pending",
      "execute",
      "verify",
      "judge",
      "waiting_user",
      "completed",
      "blocked",
      "cancelled",
      // legacy aliases accepted in views until clients catch up
      "hearing",
    ])
    .optional(),
  autonomy: z
    .object({
      runID: z.string(),
      profile: z.string(),
      phase: z.string(),
      stopReason: z.string().optional(),
      gateID: z.string().optional(),
      testAttempts: z.number(),
      maxTestAttempts: z.number().optional(),
    })
    .optional(),
})

/**
 * Broadcast whenever a session's goal changes — set, judged, or cleared. The
 * TUI mirrors this into its sync store to render the active-goal indicator and
 * the latest judge verdict. `goal` undefined means there is no active goal
 * (cleared / satisfied / impossible). Mirrors session/status.ts's Event.Status.
 */
export const Event = {
  Updated: BusEvent.define(
    "session.goal",
    z.object({
      sessionID: SessionID.zod,
      goal: GoalView.optional(),
      stopReason: z.string().optional(),
      lastVerdict: Verdict.extend({
        attempt: z.number(),
        /** The assistant message the judge evaluated — anchors the verdict to a turn. */
        messageID: z.string().optional(),
        error: z.boolean().optional(),
      }).optional(),
    }),
  ),
}

// ---- Judge prompts  ----

const JUDGE_SYSTEM = `You are evaluating a stop-condition hook in Open Mimo Code. Read the conversation transcript carefully, then judge whether the user-provided condition is satisfied.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<quote evidence from the transcript that satisfies the condition>"}
- {"ok": false, "reason": "<quote what is missing or what blocks the condition>"}
- {"ok": false, "impossible": true, "reason": "<explain why the condition can never be satisfied>"}

Always include a "reason" field, quoting specific text from the transcript whenever possible. If the transcript does not contain clear evidence that the condition is satisfied, return {"ok": false, "reason": "insufficient evidence in transcript"}.

A final assistant message with no tool calls can still satisfy the condition when it cites concrete completed evidence already in the transcript (file paths, test pass counts, commit hashes, reports). Do NOT require another tool call just to "prove" work that the transcript already shows. Conversely, a message that only announces intended next steps without evidence of completion is NOT satisfied.

Only use {"ok": false, "impossible": true} when the condition is genuinely unachievable in this session — for example: the condition is self-contradictory, it depends on a resource or capability that is unavailable, or the assistant has explicitly tried, exhausted reasonable approaches, and stated it cannot be done. Apply your own judgment when deciding this — the assistant claiming the goal is impossible is evidence, not proof; independently confirm the condition is genuinely unachievable rather than deferring to the assistant's self-assessment. Do not use it just because the goal has not been reached yet or because progress is slow. When in doubt, return {"ok": false} without "impossible".`

// The closing question appended after the full conversation.
const judgeUser = (condition: string) =>
  `Based on the conversation transcript above, has the following stopping condition been satisfied? Answer based on transcript evidence only.

Condition: ${condition}`

export type SetGoalInput = {
  condition: string
  startMessageID?: string
  autonomous?: boolean
  phase?: GoalPhase
  limits?: ConfigAutonomy.Limits
  workspaceFingerprint?: string
  changeSetID?: string
  executionScope?: string[]
  evidenceManifestPath?: string
}

export interface Interface {
  readonly set: (sessionID: SessionID, input: SetGoalInput) => Effect.Effect<void>
  readonly get: (sessionID: SessionID) => Effect.Effect<Goal | undefined>
  readonly clear: (sessionID: SessionID, stopReason?: GoalStopReason) => Effect.Effect<void>
  /** Move hearing → execute after Requirements Lock approval. */
  readonly setPhase: (sessionID: SessionID, phase: GoalPhase) => Effect.Effect<GoalPhase | undefined>
  /** Promote an in-flight goal into Super Auto (special): execute phase + rewritten condition. */
  readonly enterSpecial: (sessionID: SessionID) => Effect.Effect<Goal | undefined>
  readonly enterSpecialAll: () => Effect.Effect<number>
  /** Increment the re-entry counter, returning the new count. */
  readonly bumpReact: (sessionID: SessionID) => Effect.Effect<number>
  readonly addCost: (sessionID: SessionID, deltaUsd: number) => Effect.Effect<void>
  readonly syncCostFromTranscript: (input: {
    sessionID: SessionID
    msgs: MessageV2.WithParts[]
  }) => Effect.Effect<void>
  readonly checkBudget: (sessionID: SessionID) => Effect.Effect<{ ok: true } | { ok: false; reason: GoalStopReason }>
  readonly recordJudgeFailure: (sessionID: SessionID) => Effect.Effect<number>
  readonly stopWithReason: (input: {
    sessionID: SessionID
    reason: GoalStopReason
    lastVerdict?: Verdict & { attempt?: number; messageID?: string; error?: boolean }
  }) => Effect.Effect<void>
  /**
   * Run the judge over the conversation against the active goal's condition.
   * `msgs` is the main thread's message list; it is converted to native model
   * messages (tool calls/results/images preserved) so the judge independently
   * confirms the work rather than trusting the assistant's self-report.
   */
  readonly evaluate: (input: {
    condition: string
    msgs: MessageV2.WithParts[]
    model: { providerID: ProviderID; modelID: ModelID }
    sessionID: SessionID
  }) => Effect.Effect<Verdict>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionGoal") {}

function goalView(goal: Goal, sessionID: SessionID) {
  const run = getLatestRunForSession(sessionID)
  const autonomy =
    run && run.phase !== "cancelled"
      ? {
          runID: run.id,
          profile: run.profile,
          phase: run.phase,
          stopReason: run.stopReason,
          gateID: run.activeGateID,
          testAttempts: run.counters.testAttempts,
          maxTestAttempts: run.budgets.maxTestAttempts,
        }
      : undefined
  // Prefer durable AutonomyRun.phase when present — single source of truth.
  const phase = (run && run.phase !== "cancelled" ? run.phase : goal.phase) as GoalPhase
  return {
    condition: goal.condition,
    react: goal.react,
    startedAt: goal.startedAt,
    costUsd: goal.costUsd,
    maxTurns: goal.maxTurns,
    maxDurationMs: goal.maxDurationMs,
    maxCostUsd: goal.maxCostUsd,
    autonomous: goal.autonomous,
    phase,
    autonomy,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const auth = yield* Auth.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const elog = EffectLogger.create({ service: "SessionGoal" })

    const state = yield* InstanceState.make(
      Effect.fn("SessionGoal.state")(function* () {
        return { goals: new Map<SessionID, Goal>() }
      }),
    )

    const publish = Effect.fn("SessionGoal.publish")(function* (input: {
      sessionID: SessionID
      goal?: Goal
      stopReason?: GoalStopReason
      lastVerdict?: Verdict & { attempt: number; messageID?: string; error?: boolean }
    }) {
      yield* bus.publish(Event.Updated, {
        sessionID: input.sessionID,
        goal: input.goal ? goalView(input.goal, input.sessionID) : undefined,
        stopReason: input.stopReason,
        lastVerdict: input.lastVerdict,
      })
    })

    const set = Effect.fn("SessionGoal.set")(function* (sessionID: SessionID, input: SetGoalInput) {
      const cfg = yield* config.get()
      const limits = input.limits ?? ConfigAutonomy.limits(cfg.autonomy)
      const autonomous = input.autonomous ?? false
      const phase = canonicalizeGoalPhase(
        input.phase ?? (autonomous && ConfigAutonomy.hearingFirst(cfg.autonomy) ? "discover" : "execute"),
      )
      const data = yield* InstanceState.get(state)

      // Bind live multi-repo state when a workspace is active so Goal / Change set / scope resume together.
      const binding = yield* Effect.tryPromise(async () => {
        const { Runtime, ChangeSet, Scope, SessionFingerprint } = await import("@/repo-workspace")
        const info = await Runtime.current()
        if (!info) return undefined
        const cs = ChangeSet.loadChangeSet(sessionID)
        const scope = Scope.getScope(sessionID)
        return {
          workspaceFingerprint:
            input.workspaceFingerprint ?? SessionFingerprint.workspaceFingerprintKey(info),
          changeSetID: input.changeSetID ?? cs?.id,
          executionScope: input.executionScope ?? (scope ? [...scope] : cs?.executionScope),
          evidenceManifestPath: input.evidenceManifestPath,
        }
      }).pipe(Effect.catch(() => Effect.succeed(undefined)))

      const goal: Goal = {
        condition: input.condition,
        react: 0,
        startedAt: Date.now(),
        startMessageID: input.startMessageID,
        costUsd: 0,
        maxTurns: limits.maxTurns,
        maxDurationMs: limits.maxDurationMs,
        maxCostUsd: limits.maxCostUsd,
        judgeMaxRetries: limits.judgeMaxRetries,
        judgeFailures: 0,
        autonomous,
        phase,
        workspaceFingerprint: binding?.workspaceFingerprint ?? input.workspaceFingerprint,
        changeSetID: binding?.changeSetID ?? input.changeSetID,
        executionScope: binding?.executionScope ?? input.executionScope,
        evidenceManifestPath: binding?.evidenceManifestPath ?? input.evidenceManifestPath,
      }
      data.goals.set(sessionID, goal)
      yield* Effect.tryPromise(async () => {
        const { persistGoalBinding } = await import("@/repo-workspace/goal-binding")
        await persistGoalBinding(sessionID, goal)
      }).pipe(Effect.catch(() => Effect.void))
      yield* elog.info("goal set", {
        sessionID,
        condition: input.condition,
        autonomous: goal.autonomous,
        phase: goal.phase,
      })
      yield* publish({ sessionID, goal })
    })

    const get = Effect.fn("SessionGoal.get")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      return data.goals.get(sessionID)
    })

    const clear = Effect.fn("SessionGoal.clear")(function* (sessionID: SessionID, stopReason?: GoalStopReason) {
      const data = yield* InstanceState.get(state)
      data.goals.delete(sessionID)
      yield* elog.info("goal cleared", { sessionID, stopReason })
      yield* publish({ sessionID, stopReason })
    })

    const setPhase = Effect.fn("SessionGoal.setPhase")(function* (sessionID: SessionID, phase: GoalPhase) {
      const data = yield* InstanceState.get(state)
      const goal = data.goals.get(sessionID)
      if (!goal) return undefined
      const next = canonicalizeGoalPhase(phase)
      if (goal.phase === next) return next
      goal.phase = next
      yield* elog.info("goal phase", { sessionID, phase: next })
      yield* publish({ sessionID, goal })
      return next
    })

    const enterSpecial = Effect.fn("SessionGoal.enterSpecial")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const goal = data.goals.get(sessionID)
      if (!goal) return undefined
      const cfg = yield* config.get()
      const userText =
        ConfigAutonomy.extractUserRequest(goal.condition) ??
        goal.condition.slice(0, 2000)
      goal.condition = ConfigAutonomy.buildGoalCondition(userText, {
        docsEvidence: ConfigAutonomy.docsEvidence(cfg.autonomy),
        hearingFirst: false,
        persona: "se",
      })
      goal.autonomous = true
      goal.phase = "execute"
      yield* elog.info("goal enter special", { sessionID })
      yield* publish({ sessionID, goal })
      return goal
    })

    const enterSpecialAll = Effect.fn("SessionGoal.enterSpecialAll")(function* () {
      const data = yield* InstanceState.get(state)
      let n = 0
      for (const sessionID of data.goals.keys()) {
        const next = yield* enterSpecial(sessionID as SessionID)
        if (next) n++
      }
      return n
    })

    // Bridge for question-tool Lock Gate without a ToolRegistry↔Goal cycle.
    // Replaces process-global goalRef — AutonomyBridge is the only registrant path.
    AutonomyBridge.registerLockApproved((sessionID) => {
      Effect.runFork(setPhase(sessionID, "execute"))
    })

    const stopWithReason = Effect.fn("SessionGoal.stopWithReason")(function* (input: {
      sessionID: SessionID
      reason: GoalStopReason
      lastVerdict?: Verdict & { attempt?: number; messageID?: string; error?: boolean }
    }) {
      const data = yield* InstanceState.get(state)
      const goal = data.goals.get(input.sessionID)
      if (!goal) return
      goal.stopReason = input.reason
      yield* publish({
        sessionID: input.sessionID,
        stopReason: input.reason,
        lastVerdict: input.lastVerdict
          ? {
              ok: input.lastVerdict.ok,
              impossible: input.lastVerdict.impossible,
              reason: input.lastVerdict.reason,
              attempt: input.lastVerdict.attempt ?? goal.react,
              messageID: input.lastVerdict.messageID,
              error: input.lastVerdict.error,
            }
          : undefined,
      })
      data.goals.delete(input.sessionID)
      yield* elog.info("goal stopped", { sessionID: input.sessionID, reason: input.reason })
    })

    const bumpReact = Effect.fn("SessionGoal.bumpReact")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const goal = data.goals.get(sessionID)
      if (!goal) return 0
      goal.react += 1
      yield* publish({ sessionID, goal })
      return goal.react
    })

    const addCost = Effect.fn("SessionGoal.addCost")(function* (sessionID: SessionID, deltaUsd: number) {
      if (!deltaUsd || deltaUsd <= 0) return
      const data = yield* InstanceState.get(state)
      const goal = data.goals.get(sessionID)
      if (!goal) return
      goal.costUsd += deltaUsd
      yield* publish({ sessionID, goal })
    })

    const syncCostFromTranscript = Effect.fn("SessionGoal.syncCostFromTranscript")(function* (input: {
      sessionID: SessionID
      msgs: MessageV2.WithParts[]
    }) {
      const data = yield* InstanceState.get(state)
      const goal = data.goals.get(input.sessionID)
      if (!goal) return
      let total = 0
      for (const m of input.msgs) {
        if (m.info.role !== "assistant") continue
        if (goal.startMessageID && m.info.id <= goal.startMessageID) continue
        total += m.info.cost ?? 0
      }
      if (total === goal.costUsd) return
      goal.costUsd = total
      yield* publish({ sessionID: input.sessionID, goal })
    })

    const checkBudget = Effect.fn("SessionGoal.checkBudget")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const goal = data.goals.get(sessionID)
      if (!goal) return { ok: true as const }
      if (goal.react >= goal.maxTurns) return { ok: false as const, reason: "budget_turns" as const }
      if (Date.now() - goal.startedAt >= goal.maxDurationMs)
        return { ok: false as const, reason: "budget_duration" as const }
      if (goal.costUsd >= goal.maxCostUsd) return { ok: false as const, reason: "budget_cost" as const }
      return { ok: true as const }
    })

    const recordJudgeFailure = Effect.fn("SessionGoal.recordJudgeFailure")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      const goal = data.goals.get(sessionID)
      if (!goal) return 0
      goal.judgeFailures += 1
      yield* publish({ sessionID, goal })
      return goal.judgeFailures
    })

    const evaluate = Effect.fn("SessionGoal.evaluate")(function* (input: {
      condition: string
      msgs: MessageV2.WithParts[]
      model: { providerID: ProviderID; modelID: ModelID }
      sessionID: SessionID
    }) {
      // Multi-repo completion Goals bind an evidence manifest. Fail closed if the
      // manifest still says IN PROGRESS or lists unfinished release blockers —
      // transcript optimism must not override the written audit.
      {
        const data = yield* InstanceState.get(state)
        const bound = data.goals.get(input.sessionID)
        const manifest = bound?.evidenceManifestPath
        if (manifest) {
          const { assertEvidenceAllowsComplete } = yield* Effect.promise(() => import("@/repo-workspace/evidence-judge"))
          const gate = assertEvidenceAllowsComplete(manifest)
          if (!gate.ok) {
            return { ok: false, reason: gate.reason } satisfies Verdict
          }
        }
      }

      // AutonomyRun Evidence Manifest (FDE/SE §13): when a manifest exists or the
      // run is in judge phase, never complete on prose alone; judge_unavailable ≠ complete.
      {
        const run = getLatestRunForSession(input.sessionID)
        if (run?.lockedScope && run.phase !== "cancelled" && run.profile !== "off") {
          const { getLatestManifest, judgeFromManifest } = yield* Effect.promise(() => import("@/autonomy/evidence"))
          const manifest = getLatestManifest(run.id)
          if (manifest || run.phase === "judge") {
            const verdict = judgeFromManifest({
              lockedScope: run.lockedScope,
              manifest,
              judgeAvailable: true,
            })
            if (verdict.status === "judge_unavailable") {
              return {
                ok: false,
                reason: `judge_unavailable: ${verdict.reason}`,
              } satisfies Verdict
            }
            if (verdict.status === "blocked") {
              return { ok: false, reason: verdict.reasons.join("; ") } satisfies Verdict
            }
            if (verdict.status === "rework") {
              return { ok: false, reason: verdict.reasons.join("; ") } satisfies Verdict
            }
          }
        }
      }

      const cfg = yield* config.get()
      // Prefer the last concrete assistant upstream (Auto Model rewrites
      // providerID/modelID on the assistant message). Fall back to the caller's
      // ref — getLanguage resolves auto/free if still virtual.
      const lastAssistant = input.msgs.findLast((m) => m.info.role === "assistant")
      const judgeRef =
        lastAssistant?.info.role === "assistant" &&
        lastAssistant.info.providerID &&
        lastAssistant.info.modelID &&
        !(lastAssistant.info.providerID === "auto" && lastAssistant.info.modelID === "free")
          ? {
              providerID: lastAssistant.info.providerID as ProviderID,
              modelID: lastAssistant.info.modelID as ModelID,
            }
          : input.model
      const resolved = yield* provider.getModel(judgeRef.providerID, judgeRef.modelID)
      const language = yield* provider.getLanguage(resolved)
      const tracer = cfg.experimental?.openTelemetry
        ? Option.getOrUndefined(yield* Effect.serviceOption(OtelTracer.OtelTracer))
        : undefined

      const authInfo = yield* auth.get(resolved.providerID).pipe(Effect.orDie)
      const isOpenaiOauth = resolved.providerID === "openai" && authInfo?.type === "oauth"

      // Convert the conversation to native model messages so the judge sees the
      // real tool calls/results/images — same context the working agent had.
      //
      // `ensureNonEmptyContent` is applied by hand here because this is the ONE
      // persisted-parts→provider site that does not run `ProviderTransform.message`:
      // `model: language` below is the RAW model, with no `wrapLanguageModel` and no
      // middleware anywhere in this file, so the pre-send invariant that every other
      // build site inherits from the middleware would otherwise be absent. An empty
      // user message here reaches the judge's provider unrepaired.
      const conversation = ProviderTransform.ensureNonEmptyContent(
        yield* MessageV2.toModelMessagesEffect(input.msgs, resolved),
      )

      const clip = (_key: string, value: unknown) =>
        typeof value === "string" && value.length > 500
          ? `«${value.length} chars: ${value.slice(0, 200)}…»`
          : value
      const fullMessages = [
        ...(isOpenaiOauth ? [] : [{ role: "system", content: JUDGE_SYSTEM }]),
        ...conversation,
        { role: "user", content: judgeUser(input.condition) },
      ]
      yield* elog.debug("goal judge transcript", {
        condition: input.condition,
        messageCount: fullMessages.length,
        messages: JSON.stringify(fullMessages, clip),
      })

      // `Verdict.impossible` is optional by design, which strict mode rejects.
      // See ProviderTransform.structuredOutputOptions for the full reasoning.
      // undefined for SDKs that don't default json_schema strict on, so those
      // models keep sending no provider options at all.
      const structuredOutput = ProviderTransform.structuredOutputOptions(resolved)

      const params = {
        experimental_telemetry: {
          isEnabled: cfg.experimental?.openTelemetry,
          tracer,
          metadata: { userId: cfg.username ?? "unknown" },
        },
        temperature: 0,
        messages: [
          ...(isOpenaiOauth ? [] : [{ role: "system", content: JUDGE_SYSTEM } satisfies ModelMessage]),
          ...conversation,
          {
            role: "user",
            content: judgeUser(input.condition),
          } satisfies ModelMessage,
        ],
        model: language,
        schema: Verdict,
        providerOptions: structuredOutput && ProviderTransform.providerOptions(resolved, structuredOutput),
      } satisfies Parameters<typeof generateObject>[0]

      const verdict = yield* Effect.promise(async () => {
        if (isOpenaiOauth) {
          const result = streamObject({
            ...params,
            providerOptions: ProviderTransform.providerOptions(resolved, {
              instructions: JUDGE_SYSTEM,
              store: false,
              ...structuredOutput,
            }),
            onError: () => {},
          })
          for await (const part of result.fullStream) {
            if (part.type === "error") throw part.error
          }
          const parsed = Verdict.parse(await result.object)
          const usage = await result.usage
          return { parsed, usage }
        }
        const result = await generateObject(params)
        return { parsed: Verdict.parse(result.object), usage: result.usage }
      })

      const u = Session.getUsage({ model: resolved, usage: verdict.usage, metadata: undefined })
      const judgeCost = u.cost
      if (judgeCost > 0) yield* addCost(input.sessionID, judgeCost)

      return verdict.parsed
    })

    return Service.of({
      set,
      get,
      clear,
      setPhase,
      enterSpecial,
      enterSpecialAll,
      bumpReact,
      addCost,
      syncCostFromTranscript,
      checkBudget,
      recordJudgeFailure,
      stopWithReason,
      evaluate,
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Auth.defaultLayer),
  Layer.provide(Config.defaultLayer),
  Layer.provide(Bus.layer),
)

export * as Goal from "./goal"

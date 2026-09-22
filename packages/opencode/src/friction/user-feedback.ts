import { generateText, wrapLanguageModel } from "ai"
import { Effect, Cause } from "effect"
import { CharacterMode, characterDisplayEnabled } from "@/character/mode"
import { renderFrictionUserBody } from "@/character/renderer"
import type { StructuredFriction } from "./types"
import { frictionLearningEnabled, characterModeFromFlag } from "./flags"
import { MessageV2 } from "@/session/message-v2"
import { assistantFinalText } from "@/session/trajectory"
import * as Session from "@/session/session"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider"
import { ProviderTransform } from "@/provider"
import { providerRequestHeaders, currentProjectID } from "@/session/provider-headers"
import { Flag } from "@/flag/flag"
import { PartID, type SessionID } from "@/session/schema"
import { Bus } from "@/bus"
import { Metrics } from "@/metrics"
import { EffectLogger } from "@/effect"

const flog = EffectLogger.create({ service: "friction.user-feedback" })

export type FrictionPendingOrigin = {
  kind: "friction_pending"
  character_mode: string
  user_text: string
  friction?: StructuredFriction
  applied_rules?: Array<{ id: string; text: string }>
}

const SYSTEM = `あなたは oimo の Friction Learning 機能がユーザーに表示する短いフィードバック文を書きます。

入力には、ユーザーの追いメッセージ、摩擦分析（内部参考）、エージェントが実際に行った対応の要約が含まれます。

出力規則:
- 日本語で2〜5行。ユーザー向けの自然な文章のみ（「分類:」「Instruction Gap」「responsibility」等の内部用語は禁止）
- 追加要望・後出し条件なら「追加の要望を受け付けました。」のように受け止める
- エージェント側の検証・実装不足なら簡潔に認める（例: そこはこちらの不足です）
- 解釈のズレならそれを認める
- エージェントの対応を踏まえ、次回の指示改善に役立つヒントがあれば1行足す
- マークダウン・引用符・見出し行は禁止。本文だけを出力`

export function isFrictionPendingPart(part: MessageV2.Part): part is MessageV2.TextPart {
  if (part.type !== "text") return false
  const origin = (part.metadata as { origin?: { kind?: string } } | undefined)?.origin
  return origin?.kind === "friction_pending"
}

export function isFrictionFeedbackPart(part: MessageV2.Part): part is MessageV2.TextPart {
  if (part.type !== "text") return false
  const origin = (part.metadata as { origin?: { kind?: string } } | undefined)?.origin
  return origin?.kind === "friction_feedback"
}

function pendingOrigin(part: MessageV2.TextPart): FrictionPendingOrigin | undefined {
  const origin = (part.metadata as { origin?: FrictionPendingOrigin } | undefined)?.origin
  if (origin?.kind !== "friction_pending") return undefined
  return origin
}

function fallbackBody(origin: FrictionPendingOrigin): string | null {
  if (origin.friction) {
    return renderFrictionUserBody(
      { ...origin.friction, character_mode: origin.character_mode },
      origin.character_mode === CharacterMode.Off ? CharacterMode.Off : CharacterMode.Default,
    )
  }
  if (origin.applied_rules?.length) {
    const lines = origin.applied_rules.map((r) => `- ${r.text}`).join("\n")
    return ["前回のFrictionから得た条件を最初から考慮しています:", lines].join("\n")
  }
  return null
}

function buildUserPrompt(origin: FrictionPendingOrigin, assistantText: string): string {
  const frictionJson = origin.friction
    ? JSON.stringify(
        {
          friction_type: origin.friction.friction_type,
          responsibility: origin.friction.responsibility,
          detected_gap: origin.friction.detected_gap,
          candidate_rule: origin.friction.candidate_rule,
          scope: origin.friction.scope,
          instruction_suggestion: origin.friction.instruction_suggestion,
          improved_instruction: origin.friction.improved_instruction,
        },
        null,
        2,
      )
    : "なし"
  const rules =
    origin.applied_rules?.length ?
      origin.applied_rules.map((r) => `- ${r.text}`).join("\n")
    : "なし"
  const response = assistantText.trim().slice(0, 6000) || "(エージェントのテキスト応答なし)"
  return [
    "ユーザーの追いメッセージ:",
    origin.user_text,
    "",
    "摩擦分析 (内部参考・そのままユーザーに見せない):",
    frictionJson,
    "",
    "適用された学習ルール:",
    rules,
    "",
    "エージェントの対応要約:",
    response,
    "",
    "上記に基づき、ユーザー向け Friction フィードバック文を書いてください。",
  ].join("\n")
}

const publishAfterTurn = Effect.fn("FrictionUserFeedback.publishAfterTurn")(function* (input: {
  sessionID: SessionID
  agentID: string
}) {
  if (!frictionLearningEnabled()) return
  const characterMode = characterModeFromFlag()
  if (!characterDisplayEnabled(characterMode)) return

  const sessions = yield* Session.Service
  const provider = yield* Provider.Service
  const agents = yield* Agent.Service
  const bus = yield* Bus.Service

  const msgs = yield* sessions.messages({ sessionID: input.sessionID, agentID: input.agentID })
  const userMsg = [...msgs].reverse().find((m) => m.info.role === "user" && m.parts.some(isFrictionPendingPart))
  if (!userMsg || userMsg.info.role !== "user") return

  const pendingPart = userMsg.parts.find(isFrictionPendingPart)
  if (!pendingPart) return
  const origin = pendingOrigin(pendingPart)
  if (!origin) return

  const assistants = msgs.filter(
    (m): m is MessageV2.WithParts & { info: MessageV2.Assistant } =>
      m.info.role === "assistant" && m.info.parentID === userMsg.info.id,
  )
  const assistant = [...assistants].reverse().find((m) => m.info.time.completed != null)
  if (!assistant) return
  if (assistant.parts.some(isFrictionFeedbackPart)) return

  const assistantText = assistantFinalText(assistant.info, assistant.parts) ?? ""
  const fallback = fallbackBody(origin)

  const base = yield* agents.get("title")
  const mdl = base?.modelRef
    ? yield* provider.resolveModelRef(base.modelRef, assistant.info.providerID)
    : base?.model
      ? yield* provider.getModel(base.model.providerID, base.model.modelID)
      : ((yield* provider.getSmallModel(assistant.info.providerID)) ??
        (yield* provider.getModel(assistant.info.providerID, assistant.info.modelID)))

  const language = yield* provider.getLanguage(mdl)
  const wrapped = wrapLanguageModel({
    model: language,
    middleware: [
      {
        specificationVersion: "v3" as const,
        async transformParams(args) {
          if (args.type === "generate" || args.type === "stream") {
            // @ts-expect-error ai sdk prompt typing
            args.params.prompt = ProviderTransform.message(args.params.prompt, mdl, {})
          }
          return args.params
        },
      },
    ],
  })

  const started = Date.now()
  const generated = yield* Effect.tryPromise(() =>
    generateText({
      model: wrapped,
      system: SYSTEM,
      messages: [{ role: "user", content: buildUserPrompt(origin, assistantText) }],
      maxOutputTokens: 512,
      temperature: mdl.capabilities.temperature ? 0.4 : undefined,
      providerOptions: ProviderTransform.providerOptions(mdl, ProviderTransform.smallOptions(mdl)),
      headers: providerRequestHeaders({
        providerID: mdl.providerID,
        sessionID: input.sessionID,
        projectID: currentProjectID(),
        client: Flag.MIMOCODE_CLIENT,
        extra: mdl.headers,
      }),
      maxRetries: 1,
    }),
  ).pipe(
    Effect.catchCause((cause) =>
      flog.warn("friction feedback LLM failed", { error: Cause.pretty(cause) }).pipe(Effect.as(undefined)),
    ),
  )

  let text = generated?.text?.trim()
  if (text) {
    const u = Session.getUsage({ model: mdl, usage: generated!.usage, metadata: generated!.providerMetadata })
    yield* bus
      .publish(Metrics.ModelCall, {
        sessionID: input.sessionID,
        finish_reason: generated!.finishReason,
        latency_ms: Date.now() - started,
        cached_read_tokens: u.tokens.cache.read,
        model_id: mdl.id,
        provider: mdl.providerID,
        total_tokens_in: u.tokens.input + u.tokens.cache.read + u.tokens.cache.write,
        total_tokens_out: u.tokens.output + u.tokens.reasoning,
      })
      .pipe(Effect.ignore)
  }

  if (!text) text = fallback ?? undefined
  if (!text) {
    yield* sessions.updatePart({ ...pendingPart, ignored: true })
    return
  }

  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: assistant.info.id,
    sessionID: input.sessionID,
    type: "text",
    text,
    synthetic: true,
    metadata: {
      origin: {
        kind: "friction_feedback",
        friction_type: origin.friction?.friction_type,
        responsibility: origin.friction?.responsibility,
        character_mode: origin.character_mode,
        user_message_id: userMsg.info.id,
        generated: !!generated?.text?.trim(),
      },
    },
  })

  yield* sessions.updatePart({ ...pendingPart, ignored: true })
})

export const FrictionUserFeedback = {
  publishAfterTurn,
  isFrictionPendingPart,
  isFrictionFeedbackPart,
}

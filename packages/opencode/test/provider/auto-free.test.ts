import { describe, expect, test } from "bun:test"
import {
  classifyFailoverFailure,
  isAutoFreeCandidateUnavailableError,
  isAutoFreeFailoverAdvanceError,
  isCommitStreamEvent,
  resolveAutoFreeCandidates,
  runWithFailover,
  fccRefToOimo,
  mapFccProvider,
  isAutoFreeRef,
  AUTO_FREE_REF,
  AUTO_FREE_COOLDOWN_MS,
  rememberAutoFreeFailure,
  rememberAutoFreeSuccess,
  rememberAutoFreeGood,
  rememberAutoFreeBad,
  reorderAutoFreeCandidates,
  consumeAutoFreeStartupProbe,
  autoFreeStartupProbePending,
  resetAutoFreeSticky,
  excellenceScore,
  snapshotAutoFreeStats,
} from "../../src/provider/auto-free"
import { ProviderID, ModelID } from "../../src/provider/schema"
import type { Model } from "../../src/provider/provider"

function model(providerID: string, id: string, costInput = 0): Model {
  return {
    id: ModelID.make(id),
    providerID: ProviderID.make(providerID),
    name: id,
    api: { id, url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
    status: "active",
    headers: {},
    options: {},
    cost: { input: costInput, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 8192 },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  }
}

describe("auto-free.provider-map", () => {
  test("maps FCC provider ids to OIMO", () => {
    expect(mapFccProvider("nvidia_nim")).toBe("nvidia")
    expect(mapFccProvider("open_router")).toBe("openrouter")
    expect(mapFccProvider("opencode_zen")).toBe("opencode")
    expect(mapFccProvider("unknown_xyz")).toBeUndefined()
  })

  test("maps FCC refs", () => {
    expect(fccRefToOimo("open_router/openai/gpt-oss-120b:free")).toBe("openrouter/openai/gpt-oss-120b:free")
    expect(fccRefToOimo("nvidia_nim/nvidia/nemotron-3-super-120b-a12b")).toBe(
      "nvidia/nvidia/nemotron-3-super-120b-a12b",
    )
  })
})

describe("auto-free.resolve", () => {
  test("keeps only loaded candidates in catalog order", () => {
    const providers = {
      opencode: { models: { "big-pickle": model("opencode", "big-pickle", 0) } },
      openrouter: {
        models: {
          "openai/gpt-oss-120b:free": model("openrouter", "openai/gpt-oss-120b:free", 0),
        },
      },
    }
    const resolved = resolveAutoFreeCandidates({ providers })
    expect(resolved.map((m) => `${m.providerID}/${m.id}`)).toEqual([
      "opencode/big-pickle",
      "openrouter/openai/gpt-oss-120b:free",
    ])
  })

  test("appends all Zen free models with no user setup", () => {
    const providers = {
      opencode: {
        models: {
          "big-pickle": model("opencode", "big-pickle", 0),
          "grok-code": model("opencode", "grok-code", 0),
          "glm-5-free": model("opencode", "glm-5-free", 0),
          "paid-zen": model("opencode", "paid-zen", 5),
        },
      },
    }
    const resolved = resolveAutoFreeCandidates({ providers })
    expect(resolved.map((m) => String(m.id))).toEqual(["big-pickle", "glm-5-free", "grok-code"])
    expect(resolved.every((m) => m.cost.input === 0)).toBe(true)
  })

  test("orders active OpenCode Zen free models by ZEN_FREE_PREFERRED_ORDER", () => {
    const active = [
      "beam-free",
      "mimo-v2.6-flash-free",
      "big-pickle",
      "nemotron-3.5-lightning-free",
      "flint-40b-free",
      "deepseek-v4.1-flash-free",
      "glm-5.3-flash-free",
      "nemotron-3.5-super-vl-free",
    ]
    const providers = {
      opencode: {
        models: Object.fromEntries(active.map((id) => [id, model("opencode", id, 0)])),
      },
    }
    const resolved = resolveAutoFreeCandidates({ providers })
    expect(resolved.map((m) => String(m.id))).toEqual([
      "big-pickle",
      "mimo-v2.6-flash-free",
      "deepseek-v4.1-flash-free",
      "nemotron-3.5-lightning-free",
      "nemotron-3.5-super-vl-free",
      "glm-5.3-flash-free",
      "flint-40b-free",
      "beam-free",
    ])
  })

  test("user fallbacks override catalog but still append remaining Zen free", () => {
    const providers = {
      opencode: {
        models: {
          "big-pickle": model("opencode", "big-pickle", 0),
          "grok-code": model("opencode", "grok-code", 0),
        },
      },
      groq: { models: { "llama-3.3-70b-versatile": model("groq", "llama-3.3-70b-versatile", 0) } },
    }
    const resolved = resolveAutoFreeCandidates({
      providers,
      fallbacks: ["groq/llama-3.3-70b-versatile", "opencode/big-pickle"],
    })
    expect(resolved.map((m) => `${m.providerID}/${m.id}`)).toEqual([
      "groq/llama-3.3-70b-versatile",
      "opencode/big-pickle",
      "opencode/grok-code",
    ])
  })

  test("falls back to big-pickle when nothing else loads", () => {
    const providers = {
      opencode: { models: { "big-pickle": model("opencode", "big-pickle", 0) } },
    }
    const resolved = resolveAutoFreeCandidates({
      providers,
      fallbacks: ["openrouter/missing:free"],
    })
    expect(resolved.map((m) => `${m.providerID}/${m.id}`)).toEqual(["opencode/big-pickle"])
  })
})

describe("auto-free.failover", () => {
  test("commit events", () => {
    expect(isCommitStreamEvent({ type: "start" })).toBe(false)
    expect(isCommitStreamEvent({ type: "text-delta", text: "" })).toBe(false)
    expect(isCommitStreamEvent({ type: "text-delta", text: "hi" })).toBe(true)
    expect(isCommitStreamEvent({ type: "tool-call" })).toBe(true)
  })

  test("first-frame contract", () => {
    const retryable = Object.assign(new Error("rate limited"), { status: 429 })
    const auth = Object.assign(new Error("unauthorized"), { status: 401 })

    expect(classifyFailoverFailure(retryable, false, true)).toEqual({
      action: "advance",
      reason: "retryable-pre-commit",
    })
    expect(classifyFailoverFailure(retryable, true, true)).toEqual({
      action: "fail",
      reason: "committed",
    })
    expect(classifyFailoverFailure(retryable, false, false)).toEqual({
      action: "fail",
      reason: "no-candidates",
    })
    expect(classifyFailoverFailure(auth, false, true)).toEqual({
      action: "fail",
      reason: "non-retryable",
    })

    const notFound = Object.assign(new Error("Not Found"), { statusCode: 404 })
    expect(isAutoFreeCandidateUnavailableError(notFound)).toBe(true)
    expect(isAutoFreeFailoverAdvanceError(notFound)).toBe(true)
    expect(classifyFailoverFailure(notFound, false, true)).toEqual({
      action: "advance",
      reason: "unavailable-pre-commit",
    })

    const overloaded = new Error(
      "Streaming response failed: [502] Upstream error from Nvidia: Service temporarily overloaded",
    )
    expect(isAutoFreeFailoverAdvanceError(overloaded)).toBe(true)
    expect(classifyFailoverFailure(overloaded, false, true)).toEqual({
      action: "advance",
      reason: "retryable-pre-commit",
    })
  })

  test("runWithFailover advances only pre-commit retryable", async () => {
    const seen: string[] = []
    const advanced: string[] = []
    const result = await runWithFailover({
      candidates: ["a", "b", "c"],
      attempt: async (candidate, _index, signal) => {
        seen.push(candidate)
        if (candidate === "a") throw Object.assign(new Error("busy"), { status: 429 })
        if (candidate === "b") {
          signal.markCommitted()
          throw Object.assign(new Error("busy"), { status: 429 })
        }
        return "ok"
      },
      onAdvance: (from, to) => {
        advanced.push(`${from}->${to}`)
      },
    }).catch((e: Error) => e)

    expect(seen).toEqual(["a", "b"])
    expect(advanced).toEqual(["a->b"])
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe("busy")
  })
})

describe("auto-free.stats", () => {
  test("cold start prefers catalog order (big-pickle first)", () => {
    resetAutoFreeSticky()
    const a = model("opencode", "big-pickle")
    const b = model("nvidia", "nvidia/nemotron-3-super-120b-a12b")
    const c = model("groq", "llama-3.3-70b-versatile")
    expect(reorderAutoFreeCandidates([a, b, c]).map((m) => `${m.providerID}/${m.id}`)).toEqual([
      "opencode/big-pickle",
      "nvidia/nvidia/nemotron-3-super-120b-a12b",
      "groq/llama-3.3-70b-versatile",
    ])
  })

  test("rate-limit cooldown defers a model briefly, then catalog leader returns", () => {
    resetAutoFreeSticky()
    // Consume startup probe so this test exercises normal cooldown ranking.
    expect(consumeAutoFreeStartupProbe()).toBe(true)
    expect(autoFreeStartupProbePending()).toBe(false)

    const a = model("opencode", "big-pickle")
    const b = model("nvidia", "nvidia/nemotron-3-super-120b-a12b")
    rememberAutoFreeFailure("opencode/big-pickle", 1_000)
    rememberAutoFreeSuccess("nvidia/nvidia/nemotron-3-super-120b-a12b", 1_000)
    for (let i = 0; i < 3; i++) rememberAutoFreeGood("nvidia/nvidia/nemotron-3-super-120b-a12b", 1_000)

    expect(
      reorderAutoFreeCandidates([a, b], 1_000 + 60_000).map((m) => `${m.providerID}/${m.id}`),
    ).toEqual(["nvidia/nvidia/nemotron-3-super-120b-a12b", "opencode/big-pickle"])

    // After 15m cooldown, big-pickle's catalog prior wins again (few quality samples).
    expect(
      reorderAutoFreeCandidates([a, b], 1_000 + AUTO_FREE_COOLDOWN_MS + 1).map((m) => `${m.providerID}/${m.id}`),
    ).toEqual(["opencode/big-pickle", "nvidia/nvidia/nemotron-3-super-120b-a12b"])
  })

  test("startup probe forces Big Pickle first even while cooled", () => {
    resetAutoFreeSticky()
    const a = model("opencode", "big-pickle")
    const b = model("nvidia", "nvidia/nemotron-3-super-120b-a12b")
    rememberAutoFreeFailure("opencode/big-pickle", 1_000)
    rememberAutoFreeSuccess("nvidia/nvidia/nemotron-3-super-120b-a12b", 1_000)
    for (let i = 0; i < 3; i++) rememberAutoFreeGood("nvidia/nvidia/nemotron-3-super-120b-a12b", 1_000)

    expect(autoFreeStartupProbePending()).toBe(true)
    expect(consumeAutoFreeStartupProbe()).toBe(true)
    expect(
      reorderAutoFreeCandidates([a, b], 1_000 + 60_000, { preferBigPickle: true }).map(
        (m) => `${m.providerID}/${m.id}`,
      ),
    ).toEqual(["opencode/big-pickle", "nvidia/nvidia/nemotron-3-super-120b-a12b"])

    // Second turn: no probe — cooldown applies again.
    expect(consumeAutoFreeStartupProbe()).toBe(false)
    expect(
      reorderAutoFreeCandidates([a, b], 1_000 + 60_000).map((m) => `${m.providerID}/${m.id}`),
    ).toEqual(["nvidia/nvidia/nemotron-3-super-120b-a12b", "opencode/big-pickle"])
  })

  test("sustained poor quality demotes a model behind healthier ones", () => {
    resetAutoFreeSticky()
    const a = model("opencode", "big-pickle")
    const b = model("nvidia", "nvidia/nemotron-3-super-120b-a12b")
    for (let i = 0; i < 12; i++) rememberAutoFreeBad("opencode/big-pickle")
    for (let i = 0; i < 12; i++) rememberAutoFreeGood("nvidia/nvidia/nemotron-3-super-120b-a12b")
    expect(reorderAutoFreeCandidates([a, b]).map((m) => `${m.providerID}/${m.id}`)).toEqual([
      "nvidia/nvidia/nemotron-3-super-120b-a12b",
      "opencode/big-pickle",
    ])
  })

  test("excellenceScore rises with good outcomes", () => {
    resetAutoFreeSticky()
    expect(excellenceScore(undefined, 0)).toBeGreaterThan(excellenceScore(undefined, 1))
    rememberAutoFreeGood("opencode/big-pickle")
    const snap = snapshotAutoFreeStats()
    expect(excellenceScore(snap.refs["opencode/big-pickle"], 0)).toBeGreaterThan(excellenceScore(undefined, 0))
  })
})

describe("auto-free.ids", () => {
  test("public ref", () => {
    expect(AUTO_FREE_REF).toBe("auto/free")
    expect(isAutoFreeRef("auto", "free")).toBe(true)
    expect(isAutoFreeRef("opencode", "big-pickle")).toBe(false)
  })
})

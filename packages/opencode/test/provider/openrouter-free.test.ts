import { describe, expect, test } from "bun:test"
import {
  isOpenRouterFreeRef,
  isOpenRouterFreeModel,
  OPENROUTER_FREE_REF,
  resolveOpenRouterFreeCandidates,
  sortCatalogCandidates,
  catalog,
} from "../../src/provider/openrouter-free"
import { ProviderID, ModelID } from "../../src/provider/schema"
import type { Model } from "../../src/provider/provider"

function model(providerID: string, id: string): Model {
  return {
    id: ModelID.make(id),
    providerID: ProviderID.make(providerID),
    name: id,
    api: { id, url: "https://openrouter.ai/api/v1", npm: "@openrouter/ai-sdk-provider" },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
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

describe("openrouter-free.ids", () => {
  test("virtual ref", () => {
    expect(OPENROUTER_FREE_REF).toBe("openrouter-free/free")
    expect(isOpenRouterFreeRef("openrouter-free", "free")).toBe(true)
    expect(isOpenRouterFreeModel({ providerID: "openrouter-free", id: "free" })).toBe(true)
    expect(isOpenRouterFreeRef("auto", "free")).toBe(false)
  })
})

describe("openrouter-free.resolve", () => {
  test("loads only openrouter provider models from catalog", () => {
    const first = catalog.candidates[0]!
    const providers = {
      openrouter: {
        models: {
          [first.id]: model("openrouter", first.id),
        },
      },
    }
    const resolved = resolveOpenRouterFreeCandidates({ providers })
    expect(resolved.length).toBeGreaterThan(0)
    expect(resolved.every((m) => m.providerID === "openrouter")).toBe(true)
  })

  test("respects fallbacks override", () => {
    const id = "nvidia/nemotron-3-super-120b-a12b:free"
    const providers = {
      openrouter: {
        models: {
          [id]: model("openrouter", id),
        },
      },
    }
    const resolved = resolveOpenRouterFreeCandidates({
      providers,
      fallbacks: [`openrouter/${id}`],
    })
    expect(resolved.map((m) => m.id)).toEqual([ModelID.make(id)])
  })

  test("empty when openrouter not loaded", () => {
    expect(resolveOpenRouterFreeCandidates({ providers: {} })).toEqual([])
  })
})

describe("openrouter-free.preferred-order", () => {
  test("sorts known models before unknown", () => {
    const sorted = sortCatalogCandidates([
      "liquid/lfm-2.5-2.6b:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
    ])
    expect(sorted[0]).toBe("nvidia/nemotron-3-super-120b-a12b:free")
  })
})

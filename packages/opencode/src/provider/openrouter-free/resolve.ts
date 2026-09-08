import type { Model, Info } from "../provider"
import { ProviderID, ModelID } from "../schema"
import { catalog, type OpenRouterFreeCandidate } from "./catalog"
import { sortCatalogCandidates } from "./preferred-order"

export type OpenRouterFreeResolveInput = {
  fallbacks?: string[]
  preferred_order?: string[]
  providers: Record<string, { models: Record<string, Model> }>
}

function parseOpenRouterRef(ref: string): string | undefined {
  const prefix = "openrouter/"
  if (!ref.startsWith(prefix)) return undefined
  return ref.slice(prefix.length)
}

function lookupOpenRouter(providers: OpenRouterFreeResolveInput["providers"], modelID: string): Model | undefined {
  const provider = providers["openrouter"]
  if (!provider) return undefined
  const model = provider.models[modelID]
  if (!model) return undefined
  if (model.status === "deprecated") return undefined
  return model
}

function seedModelIds(input: OpenRouterFreeResolveInput): string[] {
  if (input.fallbacks?.length) {
    return input.fallbacks.flatMap((ref) => {
      const id = parseOpenRouterRef(ref)
      return id ? [id] : []
    })
  }
  if (input.preferred_order?.length) {
    const fromCatalog = catalog.candidates.map((c) => c.id)
    const ordered = input.preferred_order.filter((id) => fromCatalog.includes(id))
    const rest = fromCatalog.filter((id) => !ordered.includes(id))
    return [...ordered, ...sortCatalogCandidates(rest)]
  }
  return sortCatalogCandidates(catalog.candidates.map((c) => c.id))
}

/** Build ordered upstream OpenRouter models for openrouter-free/free. */
export function resolveOpenRouterFreeCandidates(input: OpenRouterFreeResolveInput): Model[] {
  const seen = new Set<string>()
  const out: Model[] = []
  for (const modelID of seedModelIds(input)) {
    const model = lookupOpenRouter(input.providers, modelID)
    if (!model) continue
    const key = `${model.providerID}/${model.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(model)
  }
  return out
}

export function catalogCandidateIds(): string[] {
  return catalog.candidates.map((c: OpenRouterFreeCandidate) => c.id)
}

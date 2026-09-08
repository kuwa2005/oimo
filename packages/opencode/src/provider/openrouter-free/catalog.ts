import catalogJson from "../openrouter-free-catalog.json"

export const OPENROUTER_FREE_PROVIDER_ID = "openrouter-free"
export const OPENROUTER_FREE_MODEL_ID = "free"
export const OPENROUTER_FREE_REF = `${OPENROUTER_FREE_PROVIDER_ID}/${OPENROUTER_FREE_MODEL_ID}`

/** Max models in one OpenRouter native `models[]` request (API hard limit: 3). */
export const OPENROUTER_FREE_NATIVE_MAX = 3

export type OpenRouterFreeCandidate = {
  id: string
  name: string
  context_length: number
  toolcall: boolean
}

export type OpenRouterFreeCatalog = {
  version: number
  tier: "free"
  source: string
  updated_at: string
  candidates: OpenRouterFreeCandidate[]
}

export const catalog = catalogJson as OpenRouterFreeCatalog

export function isOpenRouterFreeRef(providerID: string, modelID: string) {
  return providerID === OPENROUTER_FREE_PROVIDER_ID && modelID === OPENROUTER_FREE_MODEL_ID
}

export function isOpenRouterFreeModel(model: { providerID: string; id: string }) {
  return isOpenRouterFreeRef(model.providerID, model.id)
}

export function openRouterFreeUpstreamRef(modelID: string) {
  return `openrouter/${modelID}`
}

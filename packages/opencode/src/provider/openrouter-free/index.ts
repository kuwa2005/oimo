export {
  OPENROUTER_FREE_PROVIDER_ID,
  OPENROUTER_FREE_MODEL_ID,
  OPENROUTER_FREE_REF,
  OPENROUTER_FREE_NATIVE_MAX,
  catalog,
  isOpenRouterFreeRef,
  isOpenRouterFreeModel,
  openRouterFreeUpstreamRef,
} from "./catalog"
export type { OpenRouterFreeCandidate, OpenRouterFreeCatalog } from "./catalog"
export { resolveOpenRouterFreeCandidates, catalogCandidateIds } from "./resolve"
export { OPENROUTER_FREE_PREFERRED_ORDER, sortCatalogCandidates } from "./preferred-order"
export { mergeOpenRouterFreeCatalog } from "./merge-models"
export {
  OPENROUTER_FREE_COOLDOWN_MS,
  openRouterFreeRef,
  rememberOpenRouterFreeSuccess,
  rememberOpenRouterFreeFailure,
  rememberOpenRouterFreeGood,
  rememberOpenRouterFreeBad,
  reorderOpenRouterFreeCandidates,
} from "./stats"
export {
  classifyFailoverFailure,
  isAutoFreeFailoverAdvanceError as isOpenRouterFreeFailoverAdvanceError,
  isAutoFreeCandidateUnavailableError as isOpenRouterFreeCandidateUnavailableError,
  isCommitStreamEvent,
} from "../auto-free/failover"

import { OPENROUTER_FREE_MODEL_ID, OPENROUTER_FREE_PROVIDER_ID } from "./catalog"
import { ProviderID, ModelID } from "../schema"
import type { Model, Info } from "../provider"

export function openRouterFreeProviderInfo(): Info {
  return {
    id: ProviderID.make(OPENROUTER_FREE_PROVIDER_ID),
    name: "OpenRouter",
    source: "custom",
    env: ["OPENROUTER_API_KEY"],
    options: {},
    models: {
      [OPENROUTER_FREE_MODEL_ID]: openRouterFreeVirtualModel(),
    },
  }
}

export function openRouterFreeVirtualModel(): Model {
  return {
    id: ModelID.make(OPENROUTER_FREE_MODEL_ID),
    providerID: ProviderID.make(OPENROUTER_FREE_PROVIDER_ID),
    name: "OpenRouter (無料・API KEY必要)",
    family: "openrouter",
    api: {
      id: OPENROUTER_FREE_MODEL_ID,
      url: "https://openrouter.ai/api/v1",
      npm: "@openrouter/ai-sdk-provider",
    },
    status: "active",
    headers: {},
    options: {},
    cost: {
      input: 0,
      output: 0,
      cache: { read: 0, write: 0 },
    },
    limit: {
      context: 128_000,
      output: 32_000,
    },
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  }
}

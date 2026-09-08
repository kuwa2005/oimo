/**
 * Preferred try-order among OpenRouter `:free` models (coding-first).
 * Unknown catalog entries sort alphabetically after these (rank 1000).
 */
export const OPENROUTER_FREE_PREFERRED_ORDER = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
  "cohere/north-mini-code:free",
  "inclusionai/ling-3.0-flash-fin:free",
  "inclusionai/ling-3.0-flash-sante:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "dots-studio/dots-3-note-preview:free",
  "thinkingmachines/inkling:free",
  "thinkingmachines/inkling-small:free",
  "liquid/lfm-2.5-2.6b:free",
] as const

function preferredRank(modelID: string) {
  const idx = (OPENROUTER_FREE_PREFERRED_ORDER as readonly string[]).indexOf(modelID)
  return idx === -1 ? 1000 : idx
}

export function sortCatalogCandidates(ids: string[]) {
  return [...ids].sort((a, b) => {
    const ra = preferredRank(a)
    const rb = preferredRank(b)
    if (ra !== rb) return ra - rb
    return a.localeCompare(b)
  })
}

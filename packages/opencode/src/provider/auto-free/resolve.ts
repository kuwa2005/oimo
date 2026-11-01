import type { Model } from "../provider"
import { ProviderID, ModelID } from "../schema"
import zenPreferred from "../zen-free-preferred-order.json"
import { catalog, looksFreeTier, type AutoFreeCandidate } from "./catalog"

export type AutoFreeResolveInput = {
  /** User override from config.auto_free.fallbacks */
  fallbacks?: string[]
  /** Loaded providers keyed by id */
  providers: Record<string, { models: Record<string, Model> }>
}

/**
 * Preferred try-order among OpenCode Zen free (cost.input === 0, status active) models.
 * Sync with [`zen-free-preferred-order.json`](../zen-free-preferred-order.json)
 * (`bun script/sync-zen-free-preferred-order.ts` validates against models.dev).
 * Deprecated free ids are omitted at runtime. Unknown active free models sort
 * alphabetically after these (rank 1000). Zero-config users get the whole active
 * set without API keys (Zen public pool).
 */
export const ZEN_FREE_PREFERRED_ORDER = zenPreferred.order as readonly string[]

function parseRef(ref: string) {
  const [providerID, ...rest] = ref.split("/")
  if (!providerID || rest.length === 0) return undefined
  return { providerID: ProviderID.make(providerID), modelID: ModelID.make(rest.join("/")) }
}

function lookup(providers: AutoFreeResolveInput["providers"], ref: string): Model | undefined {
  const parsed = parseRef(ref)
  if (!parsed) return undefined
  const provider = providers[parsed.providerID]
  if (!provider) return undefined
  const model = provider.models[parsed.modelID]
  if (!model) return undefined
  if (model.status === "deprecated") return undefined
  return model
}

function seedRefs(fallbacks?: string[]): string[] {
  if (fallbacks && fallbacks.length > 0) return fallbacks
  return catalog.candidates.map((c: AutoFreeCandidate) => c.ref)
}

function zenFreeRank(modelID: string) {
  const idx = (ZEN_FREE_PREFERRED_ORDER as readonly string[]).indexOf(modelID)
  return idx === -1 ? 1000 : idx
}

function appendZenFreePool(
  providers: AutoFreeResolveInput["providers"],
  seen: Set<string>,
  out: Model[],
) {
  const zen = providers["opencode"]
  if (!zen) return
  const free = Object.values(zen.models)
    .filter((m) => m.cost.input === 0 && m.status !== "deprecated" && m.id !== "big-pickle-api")
    .sort((a, b) => {
      const ra = zenFreeRank(a.id)
      const rb = zenFreeRank(b.id)
      if (ra !== rb) return ra - rb
      return a.id.localeCompare(b.id)
    })
  for (const model of free) {
    const key = `${model.providerID}/${model.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(model)
  }
}

/**
 * Build ordered upstream candidates for Auto (free).
 *
 * 1. User `auto_free.fallbacks` or FCC-synced catalog (keyed providers when available)
 * 2. **All loaded OpenCode Zen free models** (cost.input === 0) — zero-config, no API key
 * 3. Last resort: big-pickle if somehow still empty
 *
 * Only models that are currently loaded are kept. Zen free models autoload with
 * `apiKey: "public"`, so a clean install gets a long free failover chain with no setup.
 */
export function resolveAutoFreeCandidates(input: AutoFreeResolveInput): Model[] {
  const seen = new Set<string>()
  const out: Model[] = []

  for (const ref of seedRefs(input.fallbacks)) {
    const model = lookup(input.providers, ref)
    if (!model) continue
    const key = `${model.providerID}/${model.id}`
    if (seen.has(key)) continue
    if (model.providerID === "opencode" && model.cost.input > 0 && !ref.endsWith(":free")) continue
    if (!looksFreeTier(ref, model.cost.input) && model.providerID === "opencode") continue
    seen.add(key)
    out.push(model)
  }

  // Zero-config backbone: every Zen free model currently loaded.
  appendZenFreePool(input.providers, seen, out)

  if (out.length === 0) {
    const pickle = lookup(input.providers, "opencode/big-pickle")
    if (pickle) out.push(pickle)
  }

  return out
}

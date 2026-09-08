import type { Info, Model } from "../provider"
import { ProviderID, ModelID } from "../schema"
import catalogJson from "../openrouter-free-catalog.json"
import type { OpenRouterFreeCatalog } from "./catalog"

const catalog = catalogJson as OpenRouterFreeCatalog

/** Inject bundled free models missing from models.dev into the loaded openrouter provider. */
export function mergeOpenRouterFreeCatalog(provider: Info | undefined) {
  if (!provider) return
  const template = Object.values(provider.models).find((m) => m.api.npm === "@openrouter/ai-sdk-provider")
  if (!template) return

  for (const entry of catalog.candidates) {
    if (provider.models[entry.id]) continue
    provider.models[entry.id] = modelFromCatalogEntry(template, entry)
  }
}

function modelFromCatalogEntry(template: Model, entry: OpenRouterFreeCatalog["candidates"][number]): Model {
  return {
    id: ModelID.make(entry.id),
    providerID: ProviderID.openrouter,
    name: entry.name,
    family: template.family,
    api: {
      id: entry.id,
      url: template.api.url,
      npm: "@openrouter/ai-sdk-provider",
    },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: {
      context: entry.context_length,
      output: Math.min(template.limit.output, 32_000),
    },
    capabilities: {
      temperature: true,
      reasoning: entry.id.includes("reasoning") || entry.id.includes("nemotron"),
      attachment: template.capabilities.attachment,
      toolcall: entry.toolcall,
      input: { ...template.capabilities.input },
      output: { ...template.capabilities.output },
      interleaved: false,
    },
    release_date: "",
    variants: {},
  }
}

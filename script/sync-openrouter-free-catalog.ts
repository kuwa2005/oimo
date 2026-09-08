#!/usr/bin/env bun
/**
 * Sync OpenRouter free models from the public API.
 *
 * Usage:
 *   bun script/sync-openrouter-free-catalog.ts
 *
 * Output: packages/opencode/src/provider/openrouter-free-catalog.json
 * See docs/openrouter-free.md
 */
import path from "path"

const outPath = path.join(import.meta.dir, "../packages/opencode/src/provider/openrouter-free-catalog.json")
const API = "https://openrouter.ai/api/v1/models"

type ApiModel = {
  id: string
  name: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  supported_parameters?: string[]
}

type Candidate = {
  id: string
  name: string
  context_length: number
  toolcall: boolean
}

function isFree(m: ApiModel) {
  if (!m.id.endsWith(":free")) return false
  const prompt = Number(m.pricing?.prompt ?? "1")
  const completion = Number(m.pricing?.completion ?? "1")
  return prompt === 0 && completion === 0
}

function supportsTools(m: ApiModel) {
  return m.supported_parameters?.includes("tools") ?? false
}

async function main() {
  const res = await fetch(API)
  if (!res.ok) throw new Error(`OpenRouter models API ${res.status}`)
  const body = (await res.json()) as { data: ApiModel[] }
  const candidates = body.data
    .filter(isFree)
    .filter(supportsTools)
    .filter((m) => (m.context_length ?? 0) >= 32_000)
    .map(
      (m): Candidate => ({
        id: m.id,
        name: m.name,
        context_length: m.context_length ?? 32_000,
        toolcall: true,
      }),
    )
    .sort((a, b) => a.id.localeCompare(b.id))

  const catalog = {
    version: 1,
    tier: "free" as const,
    source: API,
    updated_at: new Date().toISOString().slice(0, 10),
    candidates,
  }

  await Bun.write(outPath, JSON.stringify(catalog, null, 2) + "\n")
  console.log(`Wrote ${candidates.length} candidates → ${outPath}`)
  for (const c of candidates) console.log(`  - ${c.id}`)
}

await main()

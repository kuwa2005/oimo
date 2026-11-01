#!/usr/bin/env bun
/**
 * Validate (and optionally refresh) OpenCode Zen free preferred order against models.dev.
 *
 * Usage:
 *   bun script/sync-zen-free-preferred-order.ts          # validate only
 *   bun script/sync-zen-free-preferred-order.ts --write  # append missing active ids
 *
 * Output: packages/opencode/src/provider/zen-free-preferred-order.json
 * Consumer: packages/opencode/src/provider/auto-free/resolve.ts
 */
import path from "path"

const apiUrl = "https://models.dev/api.json"
const outPath = path.join(import.meta.dir, "../packages/opencode/src/provider/zen-free-preferred-order.json")

type ModelsDevModel = {
  cost?: { input?: number }
  status?: string
  tool_call?: boolean
}

type OrderFile = {
  version: number
  source: string
  updated_at: string
  note?: string
  order: string[]
}

function activeZenFree(models: Record<string, ModelsDevModel>) {
  return Object.entries(models)
    .filter(([id, m]) => (m.cost?.input ?? 1) === 0 && m.status !== "deprecated" && id !== "big-pickle-api")
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b))
}

async function main() {
  const write = process.argv.includes("--write")
  const res = await fetch(apiUrl, { headers: { "User-Agent": "oimo-sync-zen-free" } })
  if (!res.ok) throw new Error(`models.dev ${res.status}`)
  const body = (await res.json()) as { opencode?: { models?: Record<string, ModelsDevModel & { id?: string }> } }
  const zen = body.opencode?.models
  if (!zen) throw new Error("models.dev missing opencode.models")

  const active = activeZenFree(zen)
  const file = (await Bun.file(outPath).json()) as OrderFile
  const order = [...file.order]
  const inOrder = new Set(order)

  const missing = active.filter((id) => !inOrder.has(id))
  const stale = order.filter((id) => id !== "big-pickle" && !active.includes(id))

  if (missing.length) {
    console.warn("Active Zen free models not in preferred order:", missing.join(", "))
    if (write) {
      for (const id of missing) order.push(id)
    }
  }
  if (stale.length) {
    console.warn("Preferred order lists ids not active on models.dev (deprecated or removed):", stale.join(", "))
  }

  if (write && missing.length) {
    const next: OrderFile = {
      ...file,
      source: apiUrl,
      updated_at: new Date().toISOString().slice(0, 10),
      order,
    }
    await Bun.write(outPath, JSON.stringify(next, null, 2) + "\n")
    console.log(`Updated ${outPath} (+${missing.length} ids)`)
  }

  if (missing.length && !write) {
    console.error("Run with --write to append missing ids, or edit order manually for intentional ranking.")
    process.exit(1)
  }

  console.log(`OK: ${active.length} active Zen free models; preferred order has ${order.length} entries`)
  for (const id of order) console.log(`  - ${id}${active.includes(id) ? "" : " (inactive on models.dev)"}`)
}

await main()

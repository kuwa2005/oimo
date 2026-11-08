import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Global } from "../../src/global"
import {
  deriveIndexMarkdown,
  lifecycleFromStatusLine,
  parseBriefStatusFromMarkdown,
  readBriefStatuses,
  countOpenBriefs,
} from "../../src/evolve/brief-status"
import { deriveIndexForRoot } from "../../src/evolve/index-derive"

describe("brief-status", () => {
  test("maps Verified and Implemented lifecycles", () => {
    expect(lifecycleFromStatusLine("Verified")).toBe("verified")
    expect(lifecycleFromStatusLine("Implemented")).toBe("implemented")
    expect(lifecycleFromStatusLine("Open")).toBe("open")
    expect(parseBriefStatusFromMarkdown("Status: Verified\n\n# x").lifecycle).toBe("verified")
  })

  test("missing Status is unknown", () => {
    const p = parseBriefStatusFromMarkdown("# no status")
    expect(p.lifecycle).toBe("unknown")
    expect(p.warning).toContain("missing")
  })

  test("deriveIndex reflects checklist from statuses", async () => {
    const root = path.join(Global.Path.home, ".oimo", "evolve", `brief-status-${Date.now()}`)
    const briefs = path.join(root, "briefs")
    await fs.mkdir(briefs, { recursive: true })
    await Bun.write(
      path.join(briefs, "a.md"),
      ["# A", "", "Status: Verified", ""].join("\n"),
    )
    await Bun.write(
      path.join(briefs, "b.md"),
      ["# B", "", "Status: Open", ""].join("\n"),
    )
    const statuses = await readBriefStatuses(briefs)
    expect(countOpenBriefs(statuses)).toBe(1)
    const index = deriveIndexMarkdown({ statuses, generatedAt: 1_700_000_000_000 })
    expect(index).toContain("Generated from brief files at")
    expect(index).toMatch(/\[x\].*a\.md/)
    expect(index).toMatch(/\[ \].*b\.md/)
    const derived = await deriveIndexForRoot(root)
    expect(derived).toContain("verified")
    await fs.rm(root, { recursive: true, force: true })
  })
})

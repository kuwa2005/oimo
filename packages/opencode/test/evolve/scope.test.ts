import { describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Global } from "../../src/global"
import { evolveRoot, loadDashboard } from "../../src/evolve/store"
import { resolveEvolveRootsAsync } from "../../src/evolve/evolve-scope"

describe("evolve scope", () => {
  test("falls back to global when project tree is empty", async () => {
    const projectID = `scope-fallback-${Date.now()}`
    const globalRoot = evolveRoot("global")
    const projectRoot = evolveRoot(projectID)
    const worktree = await fs.mkdtemp(path.join("/tmp", "ev-scope-"))

    const marker = path.join(globalRoot, "briefs", `scope-marker-${projectID}.md`)
    await fs.mkdir(path.dirname(marker), { recursive: true })
    await Bun.write(marker, ["# marker", "", "Status: Verified", ""].join("\n"))

    const resolved = await resolveEvolveRootsAsync(projectID)
    expect(resolved.source).toBe("global")
    expect(resolved.effective).toBe(globalRoot)

    const dash = await loadDashboard({ projectID, worktree })
    expect(dash.source).toBe("global")
    expect(dash.briefsAll.length).toBeGreaterThan(0)
    expect(dash.globalCounts).toBeDefined()

    await Bun.file(marker).delete().catch(() => {})
    await fs.rm(projectRoot, { recursive: true, force: true }).catch(() => {})
    await fs.rm(worktree, { recursive: true, force: true })
  })

  test("uses project tree when artifacts exist", async () => {
    const projectID = `scope-project-${Date.now()}`
    const projectRoot = evolveRoot(projectID)
    const briefs = path.join(projectRoot, "briefs")
    await fs.mkdir(briefs, { recursive: true })
    await Bun.write(path.join(briefs, "only-project.md"), "Status: Open\n")
    const worktree = await fs.mkdtemp(path.join("/tmp", "ev-scope-"))

    const resolved = await resolveEvolveRootsAsync(projectID)
    expect(resolved.source).toBe("project")
    const dash = await loadDashboard({ projectID, worktree })
    expect(dash.root).toBe(projectRoot)
    expect(dash.briefsOpen).toContain("only-project.md")

    await fs.rm(projectRoot, { recursive: true, force: true })
    await fs.rm(worktree, { recursive: true, force: true })
  })
})

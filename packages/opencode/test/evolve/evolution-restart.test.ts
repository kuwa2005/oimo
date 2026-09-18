import { describe, expect, test } from "bun:test"
import path from "path"
import os from "os"
import fs from "fs/promises"
import {
  EvolutionState,
  EvolutionRetention,
  EvolutionEvidenceJudge,
  EvolutionHardLoop,
} from "../../src/evolve"

describe("evolution restart restore", () => {
  test("Evolution row + consent survive re-read (SQLite + consent.json)", async () => {
    const projectID = `evo-restart-${Date.now()}`
    const consent = await EvolutionRetention.recordConsent(projectID, {
      version: 1,
      rawTrajectoryOptIn: true,
      autoDream: false,
      autoDistill: false,
      autoSoftGenerate: false,
      autoHardBrief: false,
    })
    expect(consent.rawTrajectoryOptIn).toBe(true)

    const evo = EvolutionState.createEvolution({
      projectID,
      kind: "soft",
      title: "restart probe",
      evidenceIDs: ["evd_restart"],
      consent,
    })
    EvolutionState.transition({ id: evo.id, to: "candidate" })
    EvolutionState.transition({ id: evo.id, to: "planned" })

    const again = EvolutionState.getEvolution(evo.id)
    expect(again?.status).toBe("planned")
    expect(again?.consent?.rawTrajectoryOptIn).toBe(true)
    expect(EvolutionState.listAudit(evo.id).length).toBeGreaterThanOrEqual(3)

    const loaded = await EvolutionRetention.loadConsent(projectID)
    expect(loaded?.rawTrajectoryOptIn).toBe(true)

    const listed = EvolutionState.listEvolutions(projectID)
    expect(listed.some((x) => x.id === evo.id)).toBe(true)
  })
})

describe("consent / delete / pause", () => {
  test("deleteProjectEvolution removes root; pause gates auto", async () => {
    const projectID = `evo-del-${Date.now()}`
    await EvolutionRetention.recordConsent(projectID, {
      version: 1,
      rawTrajectoryOptIn: false,
      autoDream: false,
      autoDistill: false,
      autoSoftGenerate: false,
      autoHardBrief: false,
    })
    expect(EvolutionRetention.assertRawTrajectoryConsent(undefined, "automatic").ok).toBe(false)
    expect(
      EvolutionRetention.assertRawTrajectoryConsent(
        await EvolutionRetention.loadConsent(projectID),
        "manual",
      ).ok,
    ).toBe(true)

    const wiped = await EvolutionRetention.deleteProjectEvolution(projectID)
    expect(await Bun.file(path.join(wiped.root, "consent.json")).exists()).toBe(false)
    expect(EvolutionRetention.isEvolutionPaused({ evolution: { paused: true } })).toBe(true)
  })
})

describe("hard brief handoff leaves product untouched", () => {
  test("hard loop + consent path", async () => {
    const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "oimo-hard-hand-"))
    const product = path.join(worktree, "src", "main.ts")
    await fs.mkdir(path.dirname(product), { recursive: true })
    await fs.writeFile(product, "export {}\n", "utf8")
    const projectID = `hand-${Date.now()}`
    await EvolutionRetention.recordConsent(projectID, {
      version: 1,
      rawTrajectoryOptIn: true,
      autoDream: false,
      autoDistill: false,
      autoSoftGenerate: false,
      autoHardBrief: true,
    })
    const result = await EvolutionHardLoop.hardBriefLoop({
      projectID,
      worktree,
      evidenceSummary: "cross-project clarification",
      productSourceProbe: product,
    })
    expect(result.ok).toBe(true)
    expect(result.productSourceUntouched).toBe(true)
  })
})

describe("evidence judge", () => {
  test("missing or IN PROGRESS evidence is not ok; COMPLETE with all done is ok", async () => {
    const missing = EvolutionEvidenceJudge.auditEvidenceManifest("/tmp/no-such-evolve-evidence.md")
    expect(missing.ok).toBe(false)

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "oimo-evj-"))
    const file = path.join(tmp, "completion-evidence.md")
    const rows = Array.from({ length: 20 }, (_, i) => `| ${i + 1} | blocker ${i + 1} | **done** | x |`).join("\n")
    await fs.writeFile(
      file,
      `# Continuous Self-Evolution completion evidence (COMPLETE)

| # | Blocker | Status | Evidence |
|---|---------|--------|----------|
${rows}

## Security / Privacy review

Self-review completed. **重大所見なし** / no critical findings.
`,
      "utf8",
    )
    const ok = EvolutionEvidenceJudge.auditEvidenceManifest(file)
    expect(ok.ok).toBe(true)

    await fs.writeFile(file, "# IN PROGRESS\n\n| 1 | x | **open** | |\n", "utf8")
    expect(EvolutionEvidenceJudge.auditEvidenceManifest(file).ok).toBe(false)
  })
})

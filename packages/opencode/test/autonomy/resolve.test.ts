import { describe, expect, test } from "bun:test"
import { resolveAutonomyRequest, legacyModeFromProfile } from "../../src/autonomy/resolve"

describe("resolveAutonomyRequest", () => {
  test("off when empty", () => {
    const r = resolveAutonomyRequest({ source: "cli" })
    expect(r.request.profile).toBe("off")
    expect(r.request.learningLenses).toEqual([])
    expect(r.errors).toEqual([])
  })

  test("--se alone → se + lens se", () => {
    const r = resolveAutonomyRequest({ source: "cli", se: true })
    expect(r.request.profile).toBe("se")
    expect(r.request.learningLenses).toEqual(["se"])
    expect(r.request.permissionPreset).toBe("safe_auto")
  })

  test("--fde alone → fde", () => {
    const r = resolveAutonomyRequest({ source: "tui", fde: true })
    expect(r.request.profile).toBe("fde")
    expect(r.request.learningLenses).toEqual(["fde"])
  })

  test("--se --fde → fde with both lenses (all sources)", () => {
    for (const source of ["cli", "session_list", "tui"] as const) {
      const r = resolveAutonomyRequest({ source, se: true, fde: true })
      expect(r.request.profile).toBe("fde")
      expect(r.request.learningLenses).toEqual(["se", "fde"])
      expect(r.errors).toEqual([])
    }
  })

  test("spauto dominates combined flags", () => {
    const r = resolveAutonomyRequest({ source: "cli", se: true, fde: true, spauto: true })
    expect(r.request.profile).toBe("super_auto")
    expect(r.request.permissionPreset).toBe("full_auto")
    expect(r.warnings.some((w) => w.includes("spauto"))).toBe(true)
  })

  test("configMode normal aliases to se", () => {
    const r = resolveAutonomyRequest({ source: "config", configMode: "normal" })
    expect(r.request.profile).toBe("se")
    expect(r.warnings.some((w) => w.includes("normal"))).toBe(true)
  })

  test("env snapshot without live process.env", () => {
    const r = resolveAutonomyRequest({
      source: "cli",
      env: { MIMOCODE_FDE: "1" },
    })
    expect(r.request.profile).toBe("fde")
  })

  test("CLI flags beat configMode", () => {
    const r = resolveAutonomyRequest({
      source: "tui",
      se: true,
      configMode: "fde",
    })
    expect(r.request.profile).toBe("se")
  })

  test("legacyModeFromProfile bridge", () => {
    expect(legacyModeFromProfile("se")).toBe("normal")
    expect(legacyModeFromProfile("super_auto")).toBe("special")
    expect(legacyModeFromProfile("off")).toBe("none")
  })
})

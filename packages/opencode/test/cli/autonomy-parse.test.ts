import { describe, expect, test } from "bun:test"
import { parseAutonomyCliFlags, resolveAutonomyFromArgv } from "../../src/cli/autonomy-parse"

describe("parseAutonomyCliFlags (pure, no spawn)", () => {
  test("empty", () => {
    expect(parseAutonomyCliFlags([])).toEqual({
      se: false,
      fde: false,
      spauto: false,
      auto: false,
      dangerouslySkipPermissions: false,
    })
  })

  test("--se alone", () => {
    const r = resolveAutonomyFromArgv(["oimo", "--se"])
    expect(r.request.profile).toBe("se")
    expect(r.request.learningLenses).toEqual(["se"])
    expect(r.request.permissionPreset).toBe("safe_auto")
  })

  test("--fde alone", () => {
    const r = resolveAutonomyFromArgv(["--fde"])
    expect(r.request.profile).toBe("fde")
    expect(r.request.learningLenses).toEqual(["fde"])
  })

  test("--se --fde combined", () => {
    const r = resolveAutonomyFromArgv(["--se", "--fde"])
    expect(r.request.profile).toBe("fde")
    expect(r.request.learningLenses).toEqual(["se", "fde"])
    expect(r.request.permissionPreset).toBe("safe_auto")
  })

  test("--spauto dominates", () => {
    const r = resolveAutonomyFromArgv(["--se", "--fde", "--spauto"])
    expect(r.request.profile).toBe("super_auto")
    expect(r.request.permissionPreset).toBe("full_auto")
  })

  test("aliases --autonomy / --autosp / --yolo", () => {
    expect(parseAutonomyCliFlags(["--autonomy"]).se).toBe(true)
    expect(parseAutonomyCliFlags(["--autosp"]).spauto).toBe(true)
    expect(parseAutonomyCliFlags(["--yolo"]).auto).toBe(true)
  })
})

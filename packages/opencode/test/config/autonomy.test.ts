import { describe, expect, test } from "bun:test"
import * as ConfigAutonomy from "../../src/config/autonomy"

describe("ConfigAutonomy helpers", () => {
  test("hearingFirst defaults true", () => {
    expect(ConfigAutonomy.hearingFirst(undefined)).toBe(true)
    expect(ConfigAutonomy.hearingFirst({})).toBe(true)
    expect(ConfigAutonomy.hearingFirst({ hearing_first: false })).toBe(false)
  })

  test("docsEvidence defaults true", () => {
    expect(ConfigAutonomy.docsEvidence(undefined)).toBe(true)
    expect(ConfigAutonomy.docsEvidence({ docs_evidence: false })).toBe(false)
  })

  test("persona defaults se; fde when set", () => {
    expect(ConfigAutonomy.persona(undefined)).toBe("se")
    expect(ConfigAutonomy.persona({})).toBe("se")
    expect(ConfigAutonomy.persona({ persona: "fde" })).toBe("fde")
  })

  test("isRequirementsLockHeader matches EN/JA", () => {
    expect(ConfigAutonomy.isRequirementsLockHeader("Requirements Lock")).toBe(true)
    expect(ConfigAutonomy.isRequirementsLockHeader("仕様確定")).toBe(true)
    expect(ConfigAutonomy.isRequirementsLockHeader("Design Review")).toBe(false)
  })

  test("isAutonomyLockHeader matches Solution Lock for FDE", () => {
    expect(ConfigAutonomy.isAutonomyLockHeader("Solution Lock")).toBe(true)
    expect(ConfigAutonomy.isAutonomyLockHeader("解決策ロック")).toBe(true)
    expect(ConfigAutonomy.isAutonomyLockHeader("Requirements Lock")).toBe(true)
    expect(ConfigAutonomy.isAutonomyLockHeader("Design Review")).toBe(false)
  })

  test("isLockApproval detects affirmative answers", () => {
    expect(ConfigAutonomy.isLockApproval([["Approved"]])).toBe(true)
    expect(ConfigAutonomy.isLockApproval([["Changes needed"]])).toBe(false)
    expect(ConfigAutonomy.isLockApproval([["確定"]])).toBe(true)
  })

  test("buildGoalCondition includes hearing and docs when enabled", () => {
    const text = ConfigAutonomy.buildGoalCondition("電卓を作って", {
      docsEvidence: true,
      hearingFirst: true,
    })
    expect(text).toContain("電卓を作って")
    expect(text).toContain("Requirements Lock")
    expect(text).toContain("Hearing log")
    expect(text).toContain("Test specification")
    expect(text).toContain("Tests EXECUTED")
  })

  test("buildGoalCondition FDE uses Solution Lock and PoC docs", () => {
    const text = ConfigAutonomy.buildGoalCondition("Excel業務を自動化したい", {
      docsEvidence: true,
      hearingFirst: true,
      persona: "fde",
    })
    expect(text).toContain("Forward Deployed Engineer")
    expect(text).toContain("Solution Lock")
    expect(text).toContain("PoC")
    expect(text).toContain("Level 1")
    expect(text).toContain("Next Improvement")
    expect(text).not.toContain("Do NOT write implementation code until Requirements Lock is Approved")
    expect(text).toContain("After Solution Lock")
  })

  test("buildGoalCondition Super Auto skips user hearing", () => {
    const text = ConfigAutonomy.buildGoalCondition("電卓を作って", {
      docsEvidence: true,
      hearingFirst: false,
    })
    expect(text).toContain("Super Auto")
    expect(text).toContain("never wait")
    expect(text).not.toContain("Do NOT write implementation code until Requirements Lock is Approved")
    expect(text).toContain("Execute immediately")
    expect(text).toContain("Tests EXECUTED")
  })

  test("mode maps enabled + hearing_first + persona", () => {
    expect(ConfigAutonomy.mode({})).toBe("none")
    expect(ConfigAutonomy.mode({ autonomy: { enabled: true } })).toBe("se")
    expect(ConfigAutonomy.mode({ autonomy: { enabled: true, hearing_first: true } })).toBe("se")
    expect(ConfigAutonomy.mode({ autonomy: { enabled: true, hearing_first: true, persona: "fde" } })).toBe("fde")
    expect(ConfigAutonomy.mode({ autonomy: { enabled: true, hearing_first: false } })).toBe("special")
    expect(ConfigAutonomy.mode({ experimental: { auto_continue: true } })).toBe("se")
  })

  test("patchForMode and isMode", () => {
    expect(ConfigAutonomy.isMode("none")).toBe(true)
    expect(ConfigAutonomy.isMode("se")).toBe(true)
    expect(ConfigAutonomy.isMode("normal")).toBe(true)
    expect(ConfigAutonomy.isMode("fde")).toBe(true)
    expect(ConfigAutonomy.isMode("weird")).toBe(false)
    expect(ConfigAutonomy.canonicalMode("normal")).toBe("se")
    expect(ConfigAutonomy.patchForMode("none")).toEqual({ autonomy: { enabled: false } })
    expect(ConfigAutonomy.patchForMode("se")).toEqual({
      autonomy: { enabled: true, hearing_first: true, persona: "se" },
    })
    expect(ConfigAutonomy.patchForMode("normal")).toEqual({
      autonomy: { enabled: true, hearing_first: true, persona: "se" },
    })
    expect(ConfigAutonomy.patchForMode("fde")).toEqual({
      autonomy: { enabled: true, hearing_first: true, persona: "fde" },
    })
    expect(ConfigAutonomy.patchForMode("special")).toEqual({ autonomy: { enabled: true, hearing_first: false } })
  })

  test("extractUserRequest pulls the request block", () => {
    const condition = ConfigAutonomy.buildGoalCondition("電卓を作って", {
      docsEvidence: true,
      hearingFirst: false,
    })
    expect(ConfigAutonomy.extractUserRequest(condition)).toBe("電卓を作って")
  })

  test("buildGoalCondition special emphasizes self-answer", () => {
    const text = ConfigAutonomy.buildGoalCondition("席を外す", {
      docsEvidence: true,
      hearingFirst: false,
    })
    expect(text).toContain("self-answer")
    expect(text).toContain("never wait")
    expect(text).toContain("[Never-Ask]")
  })
})

import { describe, expect, test } from "bun:test"
import {
  buildEvolveTask,
  evolveAutoEnabled,
  evolveBacklogEnabled,
  evolveBriefsEnabled,
  evolveFrictionEnabled,
  evolveSessionReviewEnabled,
  evolveSkillsEnabled,
  evolveTaskForConfig,
} from "../../src/session/auto-evolve"
import type { Config } from "../../src/config"

describe("evolve track flags (opt-in auto)", () => {
  test("auto defaults to disabled when unset (complete-spec opt-in)", () => {
    const cfg = {} as Config.Info
    expect(evolveAutoEnabled(cfg)).toBe(false)
    expect(evolveSkillsEnabled(cfg)).toBe(true)
    expect(evolveBriefsEnabled(cfg)).toBe(true)
    expect(evolveFrictionEnabled(cfg)).toBe(true)
    expect(evolveBacklogEnabled(cfg)).toBe(true)
    expect(evolveSessionReviewEnabled(cfg)).toBe(true)
  })

  test("explicit evolve.auto true enables", () => {
    const cfg = { evolve: { auto: true } } as Config.Info
    expect(evolveAutoEnabled(cfg)).toBe(true)
  })

  test("explicit false disables each track", () => {
    const cfg = {
      evolve: {
        auto: false,
        skills: { enabled: false },
        briefs: { enabled: false },
        friction: { enabled: false },
        backlog: { enabled: false },
        session_review: { enabled: false },
      },
    } as Config.Info
    expect(evolveAutoEnabled(cfg)).toBe(false)
    expect(evolveSkillsEnabled(cfg)).toBe(false)
    expect(evolveBriefsEnabled(cfg)).toBe(false)
    expect(evolveFrictionEnabled(cfg)).toBe(false)
    expect(evolveBacklogEnabled(cfg)).toBe(false)
    expect(evolveSessionReviewEnabled(cfg)).toBe(false)
  })

  test("buildEvolveTask marks tracks from flags", () => {
    const text = buildEvolveTask({
      skills: true,
      briefs: false,
      friction: true,
      backlog: false,
      sessionReview: true,
      manual: true,
      arguments: "focus on TUI",
    })
    expect(text).toContain("Self Improvement Session")
    expect(text).toContain("Track A (skill knowledge base): ENABLED")
    expect(text).toContain("Track B (product modification briefs for external coding agents): DISABLED")
    expect(text).toContain("Track C (friction / Human Attention Cost analysis): ENABLED")
    expect(text).toContain("Track D (self-improvement backlog): DISABLED")
    expect(text).toContain("Track E (session self-evaluation reviews): ENABLED")
    expect(text).toContain("focus on TUI")
    expect(text).toContain("manual")
  })

  test("evolveTaskForConfig respects config opt-out", () => {
    const text = evolveTaskForConfig({
      evolve: { briefs: { enabled: false }, backlog: { enabled: false } },
    } as Config.Info)
    expect(text).toContain("Track A (skill knowledge base): ENABLED")
    expect(text).toContain("Track B (product modification briefs for external coding agents): DISABLED")
    expect(text).toContain("Track C (friction / Human Attention Cost analysis): ENABLED")
    expect(text).toContain("Track D (self-improvement backlog): DISABLED")
    expect(text).toContain("Track E (session self-evaluation reviews): ENABLED")
    expect(text).toContain("automatic")
  })
})

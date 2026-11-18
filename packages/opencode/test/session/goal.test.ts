/**
 * Unit tests for the per-session goal stop-condition service (session/goal.ts).
 */

import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Goal } from "../../src/session/goal"
import { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util"

void Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

const ses = SessionID.make("ses_goal_test")

function runGoal<A>(dir: string, fn: (goal: Goal.Interface) => Effect.Effect<A>) {
  return Instance.provide({
    directory: dir,
    fn: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const goal = yield* Goal.Service
          return yield* fn(goal)
        }).pipe(Effect.scoped, Effect.provide(Goal.defaultLayer)),
      ),
  })
}

describe("Goal state machine", () => {
  test("set then get returns the condition with react=0", async () => {
    await using tmp = await tmpdir({})
    const got = await runGoal(tmp.path, (goal) =>
      Effect.gen(function* () {
        yield* goal.set(ses, { condition: "tests pass", autonomous: true })
        return yield* goal.get(ses)
      }),
    )
    expect(got?.condition).toBe("tests pass")
    expect(got?.react).toBe(0)
    expect(got?.autonomous).toBe(true)
    expect(got?.maxTurns).toBeGreaterThan(0)
  })

  test("get with no goal returns undefined", async () => {
    await using tmp = await tmpdir({})
    const got = await runGoal(tmp.path, (goal) => goal.get(ses))
    expect(got).toBeUndefined()
  })

  test("clear removes the goal", async () => {
    await using tmp = await tmpdir({})
    const got = await runGoal(tmp.path, (goal) =>
      Effect.gen(function* () {
        yield* goal.set(ses, { condition: "build green" })
        yield* goal.clear(ses, "cancelled")
        return yield* goal.get(ses)
      }),
    )
    expect(got).toBeUndefined()
  })

  test("bumpReact increments and is reflected in get", async () => {
    await using tmp = await tmpdir({})
    const result = await runGoal(tmp.path, (goal) =>
      Effect.gen(function* () {
        yield* goal.set(ses, { condition: "x" })
        const first = yield* goal.bumpReact(ses)
        const second = yield* goal.bumpReact(ses)
        const current = yield* goal.get(ses)
        return { first, second, current: current?.react }
      }),
    )
    expect(result.first).toBe(1)
    expect(result.second).toBe(2)
    expect(result.current).toBe(2)
  })

  test("checkBudget stops at max turns", async () => {
    await using tmp = await tmpdir({})
    const result = await runGoal(tmp.path, (goal) =>
      Effect.gen(function* () {
        yield* goal.set(ses, {
          condition: "x",
          limits: { maxTurns: 2, maxDurationMs: 60_000, maxCostUsd: 10, judgeMaxRetries: 2 },
        })
        yield* goal.bumpReact(ses)
        yield* goal.bumpReact(ses)
        return yield* goal.checkBudget(ses)
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("budget_turns")
  })

  test("autonomous hearing_first starts in discover phase", async () => {
    await using tmp = await tmpdir({})
    const got = await runGoal(tmp.path, (goal) =>
      Effect.gen(function* () {
        yield* goal.set(ses, { condition: "build calc", autonomous: true, phase: "discover" })
        return yield* goal.get(ses)
      }),
    )
    expect(got?.phase).toBe("discover")
  })

  test("setPhase advances discover to execute", async () => {
    await using tmp = await tmpdir({})
    const result = await runGoal(tmp.path, (goal) =>
      Effect.gen(function* () {
        yield* goal.set(ses, { condition: "x", autonomous: true, phase: "discover" })
        const next = yield* goal.setPhase(ses, "execute")
        const current = yield* goal.get(ses)
        return { next, phase: current?.phase }
      }),
    )
    expect(result.next).toBe("execute")
    expect(result.phase).toBe("execute")
  })

  test("legacy hearing phase canonicalizes to discover", async () => {
    await using tmp = await tmpdir({})
    const got = await runGoal(tmp.path, (goal) =>
      Effect.gen(function* () {
        yield* goal.set(ses, { condition: "legacy", autonomous: true, phase: "hearing" as never })
        return yield* goal.get(ses)
      }),
    )
    expect(got?.phase).toBe("discover")
  })

  test("set resets react back to 0", async () => {
    await using tmp = await tmpdir({})
    const got = await runGoal(tmp.path, (goal) =>
      Effect.gen(function* () {
        yield* goal.set(ses, { condition: "a" })
        yield* goal.bumpReact(ses)
        yield* goal.set(ses, { condition: "b" })
        return yield* goal.get(ses)
      }),
    )
    expect(got?.condition).toBe("b")
    expect(got?.react).toBe(0)
  })
})

describe("Goal ↔ session-scoped autonomy (#66, #70)", () => {
  test("applyPersona rebuilds the condition for FDE and resets to discover on re-lock (#70)", async () => {
    await using tmp = await tmpdir({})
    const { buildGoalCondition } = await import("../../src/config/autonomy")
    const seCondition = buildGoalCondition("集計を自動化して", { docsEvidence: true, hearingFirst: true, persona: "se" })
    const got = await runGoal(tmp.path, (goal) =>
      Effect.gen(function* () {
        yield* goal.set(ses, { condition: seCondition, autonomous: true, phase: "execute" })
        yield* goal.applyPersona(ses, "fde", true)
        return yield* goal.get(ses)
      }),
    )
    expect(got?.condition).toContain("Forward Deployed Engineer")
    expect(got?.condition).toContain("集計を自動化して")
    expect(got?.condition).not.toContain("Requirements Lock")
    expect(got?.phase).toBe("discover")
  })

  test("checkBudget stops the goal when the run is blocked on test attempts (#66)", async () => {
    await using tmp = await tmpdir({})
    const { AutonomyRun } = await import("../../src/autonomy")
    const sessionID = SessionID.make(`ses_goal_run_budget_${Date.now()}`)
    const run = AutonomyRun.createRun({
      sessionID,
      projectID: "proj_goal_run_budget",
      profile: "se",
      learningLenses: ["se"],
      userRequest: "x",
      budgets: { maxTestAttempts: 1 },
    })
    AutonomyRun.bumpCounter({ id: run.id, field: "testAttempts" })
    AutonomyRun.bumpCounter({ id: run.id, field: "testAttempts" })
    expect(AutonomyRun.getRun(run.id)?.phase).toBe("blocked")
    const result = await runGoal(tmp.path, (goal) =>
      Effect.gen(function* () {
        yield* goal.set(sessionID, { condition: "x", autonomous: true })
        return yield* goal.checkBudget(sessionID)
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("budget_tests")
  })
})

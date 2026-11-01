import { describe, expect, test } from "bun:test"
import * as ConfigSessionBounds from "../../src/config/session-bounds"
import { exceeded, statsSinceUserMessage } from "../../src/session/autonomous-bounds"
import { MessageID, SessionID } from "../../src/session/schema"
import type { MessageV2 } from "../../src/session/message-v2"

describe("autonomous-bounds", () => {
  test("detects turn budget exhaustion", () => {
    const userID = MessageID.ascending()
    const asstID = MessageID.ascending()
    const msgs = [
      {
        info: { id: userID, role: "user" as const, sessionID: SessionID.make("s"), time: { created: 0 } },
        parts: [{ type: "text" as const, text: "hi", synthetic: false }],
      },
      {
        info: {
          id: asstID,
          role: "assistant" as const,
          sessionID: SessionID.make("s"),
          finish: "stop" as const,
          time: { created: 1, completed: 2 },
        },
        parts: [],
      },
    ] as MessageV2.WithParts[]
    const stats = statsSinceUserMessage(msgs, userID)
    expect(stats.assistantTurns).toBe(1)
    const hit = exceeded({
      cfg: { session_bounds: { max_autonomous_turns: 1 } },
      stats,
    })
    expect(hit.exceeded).toBe(true)
    expect(ConfigSessionBounds.enabled({ session_bounds: { max_autonomous_turns: 1 } })).toBe(true)
  })
})

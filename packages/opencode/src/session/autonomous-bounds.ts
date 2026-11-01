import { MessageV2 } from "./message-v2"
import type { MessageID } from "./schema"
import * as ConfigSessionBounds from "@/config/session-bounds"

export type AutonomousStats = {
  assistantTurns: number
  toolCalls: number
}

export function statsSinceUserMessage(msgs: MessageV2.WithParts[], lastUserID: MessageID): AutonomousStats {
  let assistantTurns = 0
  let toolCalls = 0
  for (const msg of msgs) {
    if (msg.info.id <= lastUserID) continue
    if (msg.info.role === "assistant" && msg.info.finish) assistantTurns += 1
    toolCalls += msg.parts.filter((part) => part.type === "tool").length
  }
  return { assistantTurns, toolCalls }
}

export function exceeded(input: {
  cfg: { session_bounds?: ConfigSessionBounds.Info }
  stats: AutonomousStats
}): { exceeded: true; reason: string } | { exceeded: false } {
  const lim = ConfigSessionBounds.limits(input.cfg)
  if (lim.maxAutonomousTurns != null && input.stats.assistantTurns >= lim.maxAutonomousTurns) {
    return {
      exceeded: true,
      reason: `Autonomous turn budget reached (${input.stats.assistantTurns}/${lim.maxAutonomousTurns} assistant turns since your last message). Confirm direction or send a new instruction to continue.`,
    }
  }
  if (lim.maxAutonomousToolCalls != null && input.stats.toolCalls >= lim.maxAutonomousToolCalls) {
    return {
      exceeded: true,
      reason: `Autonomous tool-call budget reached (${input.stats.toolCalls}/${lim.maxAutonomousToolCalls} tool calls since your last message). Pause for review before continuing.`,
    }
  }
  return { exceeded: false }
}

export const PAUSE_MARKER = "Autonomous execution paused:"

export function pauseReminderText(reason: string) {
  return [
    "<system-reminder>",
    `${PAUSE_MARKER} ${reason}`,
    "Stop autonomous work until the user replies. Summarize progress and ask what to do next.",
    "</system-reminder>",
  ].join("\n")
}

/**
 * Extract ScenarioObservation from structured session traces (not self-report alone).
 * Spec: docs/evolve/completion-instructions.md §11.4
 */
import { Database } from "@/storage"
import type { ScenarioObservation } from "./scenario"

export type TracePart = {
  type?: string
  tool?: string
  text?: string
  role?: string
  state?: { input?: unknown; output?: string }
}

export type TraceMessage = {
  role?: string
  parts?: TracePart[]
  time_created?: number
}

const CORRECTION_RE =
  /\b(wrong|again|already|i said|not what|incorrect|revert|undo)\b|違う|また|すでに|言っ|やり直し|戻して/i
const CLARIFY_RE = /\b(which|what file|where is|can you clarify|どれ|どのファイル|教えて)\b/i

/**
 * Build observation from real message/part traces in a time window.
 */
export function observeFromTrace(messages: TraceMessage[]): ScenarioObservation {
  let userClarifications = 0
  let toolCalls = 0
  let corrections = 0
  const skillsUsed: string[] = []
  const askedUserFor: string[] = []
  const readCounts = new Map<string, number>()

  for (const msg of messages) {
    const role = msg.role
    for (const part of msg.parts ?? []) {
      if (role === "user" && part.type === "text" && part.text) {
        if (CORRECTION_RE.test(part.text)) corrections++
        if (CLARIFY_RE.test(part.text)) {
          userClarifications++
          askedUserFor.push(part.text.slice(0, 80))
        }
      }
      if (part.type === "tool" || part.tool) {
        toolCalls++
        const tool = part.tool ?? ""
        if (tool === "skill" || tool === "skill_search") {
          const input = part.state?.input
          const name =
            input && typeof input === "object" && "name" in input
              ? String((input as { name: unknown }).name)
              : undefined
          if (name) skillsUsed.push(name)
        }
        if (tool === "read") {
          const input = part.state?.input
          const file =
            input && typeof input === "object" && "file_path" in input
              ? String((input as { file_path: unknown }).file_path)
              : input && typeof input === "object" && "path" in input
                ? String((input as { path: unknown }).path)
                : JSON.stringify(input ?? "").slice(0, 120)
          readCounts.set(file, (readCounts.get(file) ?? 0) + 1)
        }
      }
    }
  }

  let sameFileReads = 0
  for (const n of readCounts.values()) {
    if (n >= 2) sameFileReads += n
  }

  return {
    userClarifications,
    toolCalls,
    sameFileReads,
    corrections,
    skillsUsed: [...new Set(skillsUsed)],
    askedUserFor,
  }
}

type TraceRow = {
  message_id: string
  role: string | null
  time_created: number
  part_type: string | null
  tool: string | null
  text: string | null
  input_json: string | null
}

function q<T>(sql: string, ...params: unknown[]): T[] {
  return Database.Client().$client.query(sql).all(...(params as never[])) as T[]
}

/**
 * Load structured traces from SQLite for a session (preferred) or project window.
 * Used so scenario_score need not rely on model self-report alone.
 */
export function loadTraceMessages(input: {
  projectID: string
  sessionID?: string
  cutoffMs?: number
  limit?: number
}): TraceMessage[] {
  const cutoffMs = input.cutoffMs ?? Date.now() - 14 * 86400000
  const limit = input.limit ?? 5000
  const rows = input.sessionID
    ? q<TraceRow>(
        `SELECT m.id as message_id,
                json_extract(m.data, '$.role') as role,
                m.time_created as time_created,
                json_extract(p.data, '$.type') as part_type,
                json_extract(p.data, '$.tool') as tool,
                json_extract(p.data, '$.text') as text,
                json_extract(p.data, '$.state.input') as input_json
         FROM message m
         JOIN part p ON p.message_id = m.id
         JOIN session s ON s.id = m.session_id
         WHERE s.project_id = ?
           AND m.session_id = ?
           AND m.time_created > ?
         ORDER BY m.time_created, p.time_created
         LIMIT ?`,
        input.projectID,
        input.sessionID,
        cutoffMs,
        limit,
      )
    : q<TraceRow>(
        `SELECT m.id as message_id,
                json_extract(m.data, '$.role') as role,
                m.time_created as time_created,
                json_extract(p.data, '$.type') as part_type,
                json_extract(p.data, '$.tool') as tool,
                json_extract(p.data, '$.text') as text,
                json_extract(p.data, '$.state.input') as input_json
         FROM message m
         JOIN part p ON p.message_id = m.id
         JOIN session s ON s.id = m.session_id
         WHERE s.project_id = ?
           AND m.time_created > ?
         ORDER BY m.time_created, p.time_created
         LIMIT ?`,
        input.projectID,
        cutoffMs,
        limit,
      )

  const byMessage = new Map<string, TraceMessage>()
  for (const row of rows) {
    let msg = byMessage.get(row.message_id)
    if (!msg) {
      msg = {
        role: row.role ?? undefined,
        time_created: row.time_created,
        parts: [],
      }
      byMessage.set(row.message_id, msg)
    }
    let input: unknown
    if (row.input_json) {
      try {
        input = JSON.parse(row.input_json)
      } catch {
        input = row.input_json
      }
    }
    msg.parts!.push({
      type: row.part_type ?? undefined,
      tool: row.tool ?? undefined,
      text: row.text ?? undefined,
      state: input !== undefined ? { input } : undefined,
    })
  }
  return [...byMessage.values()]
}

export function observeFromDatabase(input: {
  projectID: string
  sessionID?: string
  cutoffMs?: number
}): ScenarioObservation {
  return observeFromTrace(loadTraceMessages(input))
}

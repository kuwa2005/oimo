import path from "node:path"
import { appendFile, mkdir } from "node:fs/promises"
import { Flag } from "@/flag/flag"
import { Log } from "@/util"

const log = Log.create({ service: "tui.session-log" })

export type SessionLogMode = "full" | "summary"

// What the --log file contains. "summary" (default) logs only user inputs,
// system questions with the user's answers, and the final result of each
// request; "full" logs every completed turn. Logging itself is on by default
// (auto file under ./.oimo/); use `--no-log` to disable.
export function sessionLogMode(): SessionLogMode {
  return Flag.MIMOCODE_LOG_MODE === "full" ? "full" : "summary"
}

const REPORT_DELIVERABLE = ["成果物", "完成物", "納品物", "deliverables"]
const REPORT_STRUCTURE = ["構成", "ファイル構成"]
const REPORT_CONCLUSION = ["主要な結論", "結論", "まとめ", "サマリ", "summary"]
const REPORT_VERIFICATION = ["検証", "テスト結果", "verification"]

function normalizeHeading(text: string): string {
  return text.replace(/[*`]/g, "").replace(/\s+/g, "").toLowerCase()
}

function matchesAny(text: string, keywords: ReadonlyArray<string>): boolean {
  const normalized = normalizeHeading(text)
  return keywords.some((keyword) => normalized.includes(keyword))
}

// A completion report is the final answer of a task: it has both a
// deliverables section and a verification section. Extracting only those
// sections keeps the log readable; the preamble ("done", thanks) is dropped.
export function extractCompletionReport(text: string): string | undefined {
  const lines = text.split("\n")
  const headings: { level: number; text: string; start: number; end: number }[] = []
  let fence: string | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const marker = line.startsWith("```") ? "```" : line.startsWith("~~~") ? "~~~" : undefined
    if (marker) {
      if (!fence) fence = marker
      else if (fence === marker) fence = undefined
      continue
    }
    if (fence) continue
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i])
    if (!match) continue
    headings.push({ level: match[1].length, text: match[2], start: i, end: lines.length })
  }

  for (const heading of headings) {
    const next = headings.find((candidate) => candidate.start > heading.start && candidate.level <= heading.level)
    if (next) heading.end = next.start
  }

  if (!headings.some((heading) => matchesAny(heading.text, REPORT_DELIVERABLE))) return undefined
  if (!headings.some((heading) => matchesAny(heading.text, REPORT_VERIFICATION))) return undefined

  const targets = [...REPORT_DELIVERABLE, ...REPORT_STRUCTURE, ...REPORT_CONCLUSION, ...REPORT_VERIFICATION]
  const selected: typeof headings = []
  for (const heading of headings) {
    if (!matchesAny(heading.text, targets)) continue
    // A nested heading inside an already selected section is already covered.
    if (selected.some((outer) => heading.start > outer.start && heading.start < outer.end)) continue
    selected.push(heading)
  }

  const body = selected
    .map((heading) => lines.slice(heading.start, heading.end).join("\n").trim())
    .filter(Boolean)
    .join("\n\n")
  return body || undefined
}

export function formatSessionLogEntry(question: string, answer: string, time: number): string {
  return [
    `## ${new Date(time).toISOString()}`,
    ``,
    `### User`,
    ``,
    question.trim(),
    ``,
    `### oimo`,
    ``,
    answer.trim(),
    ``,
    `---`,
    ``,
  ].join("\n")
}

export function formatSessionLogUser(text: string, time: number): string {
  return [
    `## ${new Date(time).toISOString()}`,
    ``,
    `### User`,
    ``,
    text.trim(),
    ``,
    `---`,
    ``,
  ].join("\n")
}

export function formatSessionLogResult(text: string, time: number): string {
  return [
    `## ${new Date(time).toISOString()}`,
    ``,
    `### Result`,
    ``,
    text.trim(),
    ``,
    `---`,
    ``,
  ].join("\n")
}

export function formatSessionLogQA(input: {
  questions: ReadonlyArray<{ question: string; options?: ReadonlyArray<{ label: string }> }>
  answers: ReadonlyArray<ReadonlyArray<string>>
  time: number
}): string {
  const questions = input.questions.map((q, i) => {
    const options =
      q.options && q.options.length > 0 ? `\nOptions: ${q.options.map((o) => o.label).join(" / ")}` : ``
    return `${i + 1}. ${q.question}${options}`
  })
  const answers = input.questions.map((_, i) => {
    const answer = input.answers[i] ?? []
    return `${i + 1}. ${answer.length > 0 ? answer.join(", ") : "(no answer)"}`
  })
  return [
    `## ${new Date(input.time).toISOString()}`,
    ``,
    `### Question`,
    ``,
    questions.join("\n\n"),
    ``,
    `### Answer`,
    ``,
    answers.join("\n"),
    ``,
    `---`,
    ``,
  ].join("\n")
}

// Best-effort: a failed append must never break the TUI.
async function appendEntry(entry: string): Promise<void> {
  const file = await sessionLogFile()
  if (!file) return
  return (async () => {
    await mkdir(path.dirname(file), { recursive: true })
    await appendFile(file, entry, "utf8")
  })().catch((error) => log.warn("append failed", { file, error: String(error) }))
}

export function appendSessionLog(input: { question: string; answer: string; time: number }): Promise<void> {
  return appendEntry(formatSessionLogEntry(input.question, input.answer, input.time))
}

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

export async function generateSessionLogFileName(dir: string, now: Date = new Date()): Promise<string> {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}`
  const base = path.join(dir, `oimo-session-${stamp}`)
  let candidate = `${base}.md`
  for (let i = 1; await Bun.file(candidate).exists(); i++) {
    candidate = `${base}-${i}.md`
  }
  return candidate
}

export async function resolveSessionLogFile(input: {
  explicit: string | undefined
  auto: boolean
  cwd: string
  now?: Date
}): Promise<string | undefined> {
  // Explicit path always wins over auto (env MIMOCODE_LOG or `--log path`).
  if (input.explicit) return input.explicit
  if (input.auto) return generateSessionLogFileName(path.join(input.cwd, ".oimo"), input.now)
  return undefined
}

// Resolved once per env (tests swap MIMOCODE_LOG/MIMOCODE_LOG_AUTO between
// cases; the key changes so the cache re-resolves instead of pinning a file).
let fileCache: { key: string; file: string | undefined } | undefined

async function sessionLogFile(): Promise<string | undefined> {
  const key = `${Flag.MIMOCODE_LOG ?? ""}|${Flag.MIMOCODE_LOG_AUTO ? "1" : "0"}|${process.cwd()}`
  if (fileCache?.key === key) return fileCache.file
  const file = await resolveSessionLogFile({
    explicit: Flag.MIMOCODE_LOG,
    auto: Flag.MIMOCODE_LOG_AUTO,
    cwd: process.cwd(),
  })
  fileCache = { key, file }
  return file
}

let pendingResult: { text: string; time: number } | undefined

// Summary mode: the result of a request cycle is the last completed assistant
// text before the next real user input (or session end), so it is buffered and
// written by flushSessionLogResult instead of being appended per turn.
export function recordSessionLogAssistant(text: string, time: number): Promise<void> {
  if (sessionLogMode() !== "summary") return Promise.resolve()
  const trimmed = text.trim()
  if (!trimmed) return Promise.resolve()
  pendingResult = { text: trimmed, time }
  return Promise.resolve()
}

export function flushSessionLogResult(): Promise<void> {
  if (sessionLogMode() !== "summary") return Promise.resolve()
  const pending = pendingResult
  if (!pending) return Promise.resolve()
  pendingResult = undefined
  const report = extractCompletionReport(pending.text)
  return appendEntry(formatSessionLogResult(report ?? pending.text, pending.time))
}

export function recordSessionLogUser(text: string, time: number): Promise<void> {
  if (sessionLogMode() !== "summary") return Promise.resolve()
  const trimmed = text.trim()
  if (!trimmed) return Promise.resolve()
  return (async () => {
    await flushSessionLogResult()
    await appendEntry(formatSessionLogUser(trimmed, time))
  })()
}

export function recordSessionLogQA(input: {
  questions: ReadonlyArray<{ question: string; options?: ReadonlyArray<{ label: string }> }>
  answers: ReadonlyArray<ReadonlyArray<string>>
  time: number
}): Promise<void> {
  if (sessionLogMode() !== "summary") return Promise.resolve()
  return appendEntry(formatSessionLogQA(input))
}

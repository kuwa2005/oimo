import path from "path"
import { existsSync, readFileSync } from "fs"
import { isRecord } from "@/util/record"
import { which } from "@/util/which"

export type ExistenceFinding = {
  kind: "missing_script" | "missing_path" | "missing_binary"
  claim: string
  detail: string
}

const SCRIPT_RUN =
  /(?:^|[;&|]\s*)(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([A-Za-z0-9:_-]+)(?:\s|$)/g

/** Relative/local paths with a source-like extension that look like file claims. */
const PATH_CLAIM =
  /(?:^|[\s"'`(])((?:\.{1,2}\/|[A-Za-z0-9_.-]+\/)[A-Za-z0-9_./@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|json|md))(?=$|[\s"'`),:;])/g

/** Simple leading command names that must exist on PATH (pre-flight). */
const BINARY_CLAIM = /(?:^|[;&|]\s*|^\s*)([a-zA-Z0-9._+-]+)(?:\s|$)/

const BINARY_HINTS: Record<string, string> = {
  sqlite3:
    "Install sqlite3, or use an in-repo alternative (e.g. `bun`/`node` script, package.json script) instead of invoking sqlite3 directly.",
}

const BINARY_SKIP = new Set([
  "bash",
  "sh",
  "cd",
  "echo",
  "export",
  "set",
  "true",
  "false",
  "test",
  "[",
  "if",
  "then",
  "else",
  "fi",
  "for",
  "do",
  "done",
  "while",
  "case",
  "esac",
  "sudo",
  "env",
  "time",
  "nohup",
  "xargs",
  "tee",
  "cat",
  "grep",
  "sed",
  "awk",
  "find",
  "ls",
  "mkdir",
  "rm",
  "cp",
  "mv",
  "touch",
  "chmod",
  "chown",
  "git",
  "curl",
  "wget",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "node",
  "python",
  "python3",
  "php",
  "docker",
  "make",
  "cargo",
  "go",
  "rustc",
])

const SKIP_PREFIX = /^(https?:|npm:|node:|jsr:|data:)/i

export function packageScripts(cwd: string): Set<string> {
  const file = path.join(cwd, "package.json")
  if (!existsSync(file)) return new Set()
  const raw = readFileSync(file, "utf8")
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed) || !isRecord(parsed.scripts)) return new Set()
  return new Set(Object.keys(parsed.scripts))
}

export function collectScriptClaims(command: string) {
  const claims: string[] = []
  for (const match of command.matchAll(SCRIPT_RUN)) {
    const name = match[1]
    // Built-in package-manager verbs that are not package.json scripts.
    if (["test", "start", "stop", "restart", "install", "ci", "publish", "pack", "link", "unlink"].includes(name)) {
      // `npm test` / `bun test` are builtins; `npm run test` still needs the script.
      if (!/\brun\s+/.test(match[0])) continue
    }
    // `bun test` / `bun typecheck` as direct commands — only treat as script when `run` is present.
    if ((match[0].includes("bun ") || match[0].includes("bun\t")) && !/\brun\s+/.test(match[0])) {
      if (["test", "typecheck", "install", "x", "run"].includes(name)) continue
    }
    claims.push(name)
  }
  return [...new Set(claims)]
}

export function collectPathClaims(command: string) {
  const claims: string[] = []
  for (const match of command.matchAll(PATH_CLAIM)) {
    const claim = match[1]
    if (SKIP_PREFIX.test(claim)) continue
    if (claim.includes("*")) continue
    claims.push(claim)
  }
  return [...new Set(claims)]
}

export function collectBinaryClaims(command: string) {
  const trimmed = command.trim()
  if (!trimmed || trimmed.startsWith("#")) return [] as string[]
  const claims: string[] = []
  for (const segment of trimmed.split(/(?:&&|\|\||;)/)) {
    const head = segment.trim().match(BINARY_CLAIM)?.[1]
    if (!head) continue
    const name = head.toLowerCase()
    if (BINARY_SKIP.has(name)) continue
    if (name.includes("/")) continue
    if (name.startsWith("-")) continue
    claims.push(name)
    break
  }
  return [...new Set(claims)]
}

export function checkCommand(
  command: string,
  input: {
    cwd: string
    scripts?: Set<string>
    exists?: (absolutePath: string) => boolean
    onPath?: (name: string) => boolean
  },
): ExistenceFinding[] {
  const scripts = input.scripts ?? packageScripts(input.cwd)
  const exists = input.exists ?? ((absolutePath: string) => existsSync(absolutePath))
  const onPath = input.onPath ?? ((name: string) => which(name) != null)
  const findings: ExistenceFinding[] = []

  for (const name of collectScriptClaims(command)) {
    if (scripts.has(name)) continue
    findings.push({
      kind: "missing_script",
      claim: name,
      detail: `Package script "${name}" is not defined in ${path.join(input.cwd, "package.json")}. Use an existing script or add it before running.`,
    })
  }

  for (const claim of collectPathClaims(command)) {
    const absolute = path.resolve(input.cwd, claim)
    if (exists(absolute)) continue
    findings.push({
      kind: "missing_path",
      claim,
      detail: `Local path "${claim}" does not exist under ${input.cwd}. Correct the path or create the file intentionally.`,
    })
  }

  for (const name of collectBinaryClaims(command)) {
    if (onPath(name)) continue
    const hint = BINARY_HINTS[name] ?? `Ensure "${name}" is installed and on PATH before running this command.`
    findings.push({
      kind: "missing_binary",
      claim: name,
      detail: hint,
    })
  }

  return findings
}

export function formatFindings(findings: ExistenceFinding[]) {
  if (findings.length === 0) return ""
  return [
    "Existence/claim check failed — fix these invented references before re-running:",
    ...findings.map((finding) => `- [${finding.kind}] ${finding.claim}: ${finding.detail}`),
  ].join("\n")
}

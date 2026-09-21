/**
 * High-confidence secret redaction for compliance / Evidence / bash cleanse.
 * Replacements never include the matched value — kind names only in hits.
 */

const PLACEHOLDER_VALUES = new Set(
  [
    "***",
    "****",
    "xxxxx",
    "xxxxxx",
    "redacted",
    "[redacted]",
    "changeme",
    "changeme!",
    "password",
    "secret",
    "token",
    "your-api-key",
    "your_api_key",
    "your-token",
    "your_token",
    "example",
    "placeholder",
    "<password>",
    "<secret>",
    "<token>",
    "<api-key>",
    "<api_key>",
    "insert-key-here",
    "todo",
    "fixe",
    "xxx",
  ].map((s) => s.toLowerCase()),
)

function isPlaceholderValue(raw: string): boolean {
  const v = raw.replace(/^['"]|['"]$/g, "").trim()
  if (v.length === 0) return true
  if (PLACEHOLDER_VALUES.has(v.toLowerCase())) return true
  if (/^\$\{?[A-Z0-9_]+\}?$/i.test(v)) return true
  if (/^<.*>$/.test(v)) return true
  if (/^\{\{.*\}\}$/.test(v)) return true
  // Code symbols / env lookups — not pasted secrets
  if (/^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(v)) return true
  if (/^(process\.env\.|os\.environ|os\.getenv|Deno\.env)/i.test(v)) return true
  if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+(\(\))?$/.test(v)) return true
  // camelCase / PascalCase identifier (e.g. getPassword, apiKeyValue)
  if (/^[A-Za-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/.test(v)) return true
  return false
}

type Pattern = {
  name: string
  re: RegExp
}

const SECRET_PATTERNS: Pattern[] = [
  {
    name: "private_key",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  { name: "aws_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "github_token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { name: "openai_key", re: /\bsk-[A-Za-z0-9_\-]{20,}\b/g },
  { name: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_\-]{20,}\b/g },
  { name: "slack_token", re: /\bxox[abprs]-[A-Za-z0-9\-]{10,}\b/g },
  {
    name: "jwt",
    re: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g,
  },
  {
    name: "bearer",
    re: /\b(?:Bearer|Token)\s+[A-Za-z0-9\-._~+/]+=*/gi,
  },
  {
    name: "connection_string",
    re: /\b(?:postgres|mysql|mongodb|redis|amqp|mongodb\+srv):\/\/[^\s'"]+/gi,
  },
  {
    name: "generic_token",
    re: /\b(?:api[_-]?key|access[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
  },
]

export function redactSecrets(text: string): { text: string; redacted: boolean; hits: string[] } {
  let out = text
  const hits: string[] = []
  for (const p of SECRET_PATTERNS) {
    p.re.lastIndex = 0
    let matched = false
    out = out.replace(p.re, (full) => {
      if (p.name === "generic_token") {
        const eq = full.match(/[:=]\s*['"]?([^\s'"]{8,})['"]?\s*$/i)
        const value = eq?.[1] ?? ""
        if (isPlaceholderValue(value)) return full
      }
      matched = true
      return `[REDACTED:${p.name}]`
    })
    if (matched) hits.push(p.name)
    p.re.lastIndex = 0
  }
  return { text: out, redacted: hits.length > 0, hits }
}

/** Apply redactSecrets to every non-synthetic text part. Returns total hit count (kinds may repeat). */
export function redactUserParts<T extends { type: string; text?: string; synthetic?: boolean }>(
  parts: T[],
): { parts: T[]; hits: string[]; redacted: boolean } {
  const hits: string[] = []
  const next = parts.map((part) => {
    if (part.type !== "text") return part
    if (part.synthetic) return part
    if (typeof part.text !== "string" || part.text.length === 0) return part
    const result = redactSecrets(part.text)
    if (!result.redacted) return part
    hits.push(...result.hits)
    return { ...part, text: result.text }
  })
  return { parts: next, hits, redacted: hits.length > 0 }
}

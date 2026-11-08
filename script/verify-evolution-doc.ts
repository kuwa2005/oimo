// 自己進化レポートのドクリント。
// 仕様: 自己進化202611108.md §6.1 の D1〜D10。
// 使い方: bun script/verify-evolution-doc.ts [path]

const path = process.argv[2] ?? "自己進化202611108.md"
const text = await Bun.file(path).text()
const lines = text.split("\n")

type Heading = { level: number, text: string, line: number, slug: string }
const headings: Heading[] = []
const inFence: boolean[] = []
let fenced = false
for (let i = 0; i < lines.length; i++) {
  if (/^\s*```/.test(lines[i])) {
    inFence[i] = true
    fenced = !fenced
    continue
  }
  inFence[i] = fenced
  if (fenced) continue
  const m = /^(#{1,6})\s+(.*)$/.exec(lines[i])
  if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: i + 1, slug: slugify(m[2].trim()) })
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
}

const results: { id: string, ok: boolean, detail: string[] }[] = []
const check = (id: string, ok: boolean, detail: string[] = []) => results.push({ id, ok, detail })

// D1: 必須 H2（0.〜6.）
const requiredH2 = ["0.", "1.", "2.", "3.", "4.", "5.", "6."]
const h2 = headings.filter((h) => h.level === 2)
const missingH2 = requiredH2.filter((p) => !h2.some((h) => h.text.startsWith(p)))
check("D1", missingH2.length === 0, missingH2.map((p) => `欠落: H2 "${p}"`))

// D2: 必須サブ見出し
const requiredSub = [
  "0.1", "1.1", "1.2", "2.1", "2.2", "2.3", "2.4",
  "3.1", "3.2", "3.3", "3.4",
  "4.1", "4.2", "4.3",
  "5.1", "5.2", "5.3", "5.4",
  "6.1", "6.2", "6.3",
]
const allHeadingText = headings.map((h) => h.text)
const missingSub = requiredSub.filter((p) => !allHeadingText.some((t) => t.startsWith(p)))
check("D2", missingSub.length === 0, missingSub.map((p) => `欠落: 見出し "${p}"`))

function stripInlineCode(line: string) {
  return line.replace(/`[^`\n]*`/g, "")
}

// D3: 内部アンカーリンクの解決
const slugs = new Set(headings.map((h) => h.slug))
const badAnchors: string[] = []
for (let i = 0; i < lines.length; i++) {
  if (inFence[i]) continue
  for (const m of stripInlineCode(lines[i]).matchAll(/\]\(#([^)]+)\)/g)) {
    if (!slugs.has(decodeURIComponent(m[1]))) badAnchors.push(`${i + 1}行目: #${m[1]}`)
  }
}
check("D3", badAnchors.length === 0, badAnchors)

// D4: 相対リンクの実在（外部URL・アンカーは除外）
const badLinks: string[] = []
for (let i = 0; i < lines.length; i++) {
  if (inFence[i]) continue
  for (const m of stripInlineCode(lines[i]).matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1].trim()
    if (target.startsWith("#") || /^[a-z]+:\/\//i.test(target) || target.startsWith("mailto:")) continue
    const file = target.split("#")[0]
    if (!file) continue
    if (!(await Bun.file(file).exists())) badLinks.push(`${i + 1}行目: ${file}`)
  }
}
check("D4", badLinks.length === 0, badLinks)

// D5: 秘密混入
const secretPatterns: { name: string, re: RegExp }[] = [
  { name: "OpenAI風キー", re: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: "GitHubトークン", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "AWSアクセスキー", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "秘密鍵", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "パスワード代入", re: /password\s*=\s*["'][^"']{4,}/i },
  { name: "Slackトークン", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
]
const secrets: string[] = []
for (let i = 0; i < lines.length; i++) {
  if (inFence[i]) continue
  for (const p of secretPatterns) if (p.re.test(lines[i])) secrets.push(`${i + 1}行目: ${p.name}`)
}
check("D5", secrets.length === 0, secrets)

// D6: 成果物名リテラル
const nameMatches = [...text.matchAll(/自己進化\d+\.md/g)].map((m) => m[0])
const badNames = [...new Set(nameMatches)].filter((n) => n !== "自己進化202611108.md")
check(
  "D6",
  nameMatches.includes("自己進化202611108.md") && badNames.length === 0,
  [
    ...(nameMatches.includes("自己進化202611108.md") ? [] : ["正しいファイル名リテラルが無い"]),
    ...badNames.map((n) => `表記ゆれ: ${n}`),
  ],
)

// D7: 空セクション
const emptySections: string[] = []
for (let i = 0; i < headings.length; i++) {
  const start = headings[i].line
  const end = i + 1 < headings.length ? headings[i + 1].line - 1 : lines.length
  const body = lines.slice(start, end).join("\n").trim()
  if (body.length === 0) emptySections.push(`${start}行目: ${headings[i].text}`)
}
check("D7", emptySections.length === 0, emptySections)

// D8: 参照IDの実在（§3.1 の表に存在すること）
const section3 = sectionText("3.", "4.")
const blogRefs = new Set([...text.matchAll(/BLOG-\d{3}/g)].map((m) => m[0]))
const missingBlog = [...blogRefs].filter((id) => !section3.includes(id))
const evbRefs = new Set([...text.matchAll(/EVB-\d{8}/g)].map((m) => m[0]))
const missingEvb = [...evbRefs].filter((id) => !section3.includes(id))
check("D8", missingBlog.length === 0 && missingEvb.length === 0, [
  ...missingBlog.map((id) => `§3.1 に無い: ${id}`),
  ...missingEvb.map((id) => `§3.1 に無い: ${id}`),
])

function sectionText(startPrefix: string, endPrefix: string) {
  const startIdx = headings.findIndex((h) => h.level === 2 && h.text.startsWith(startPrefix))
  if (startIdx === -1) return ""
  const endIdx = headings.findIndex((h, i) => i > startIdx && h.level === 2 && h.text.startsWith(endPrefix))
  const from = headings[startIdx].line - 1
  const to = endIdx === -1 ? lines.length : headings[endIdx].line - 1
  return lines.slice(from, to).join("\n")
}

// D9: 数値指標に窓ラベルが付いている（§7 の各サブセクション単位で検証）
const windowTokens = ["14日", "30日", "180日", "単日", "ゲート窓", "日窓", "窓"]
const metricRe = /\d[\d,]*(回|件|セッション|msgs|calls|parts|行)/
const d9Issues: string[] = []
const section7Start = headings.findIndex((h) => h.level === 2 && h.text.startsWith("7."))
if (section7Start !== -1) {
  const section7End = headings.findIndex((h, i) => i > section7Start && h.level === 2)
  const from = headings[section7Start].line - 1
  const to = section7End === -1 ? lines.length : headings[section7End].line - 1
  let contextHasWindow = false
  for (let i = from; i < to; i++) {
    const line = lines[i]
    if (/^#{2,4}\s/.test(line)) {
      contextHasWindow = windowTokens.some((t) => line.includes(t))
      continue
    }
    if (windowTokens.some((t) => line.includes(t))) contextHasWindow = true
    if (metricRe.test(line) && !contextHasWindow) d9Issues.push(`${i + 1}行目: 窓ラベル無し -> ${line.trim().slice(0, 60)}`)
  }
}
check("D9", d9Issues.length === 0, d9Issues)

// D10: §5 の各 brief に 1〜9 の番号付き小見出し
const d10Issues: string[] = []
const briefs = headings.filter((h) => h.level === 3 && /^5\.\d/.test(h.text))
for (const brief of briefs) {
  const idx = headings.indexOf(brief)
  const next = headings.slice(idx + 1).find((h) => h.level <= 3)
  const from = brief.line
  const to = next ? next.line - 1 : lines.length
  const numbers = new Set<number>()
  for (const line of lines.slice(from, to)) {
    const m = /^#{4}\s+(\d)\./.exec(line)
    if (m) numbers.add(Number(m[1]))
  }
  const missing = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => !numbers.has(n))
  if (missing.length) d10Issues.push(`${brief.text}: 欠落 ${missing.join(",")}`)
}
check("D10", briefs.length > 0 && d10Issues.length === 0, [
  ...(briefs.length === 0 ? ["§5 に brief が無い"] : []),
  ...d10Issues,
])

let failed = 0
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.id}${r.ok ? "" : `  (${r.detail.length})`}`)
  if (!r.ok) {
    failed++
    for (const d of r.detail) console.log(`        - ${d}`)
  }
}
console.log(`\n${results.length - failed}/${results.length} PASS — ${path}`)
process.exit(failed === 0 ? 0 : 1)

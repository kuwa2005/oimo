export const meta = {
  name: "evolve-apply",
  description:
    "Human-approved semi-automatic apply of an oimo evolve brief: implement in an isolated worktree, verify, and open a draft PR. Never applies without args.approved=true and args.brief_hash matching the brief file.",
  whenToUse:
    "Use after evolve-review recommends adopt/revise and the USER explicitly approved. Pass args.brief, args.approved=true, and args.brief_hash (sha256 of brief contents). Optional args.branch, args.title, args.approval_event_id. Does not merge.",
  phases: [
    { title: "Guard", detail: "Require approved=true + brief_hash; refuse otherwise" },
    { title: "Load brief", detail: "Read brief; verify hash; refuse high-risk scopes without allow_dangerous" },
    { title: "Implement", detail: "Worktree-isolated agent implements acceptance criteria" },
    { title: "Verify", detail: "typecheck / targeted tests; evolve_status gate" },
    { title: "PR", detail: "Draft PR only if verify+gate passed" },
  ],
}

const _a = (() => {
  if (args == null || args === undefined) return {}
  if (typeof args === "string") {
    try {
      const p = JSON.parse(args)
      return typeof p === "object" && p !== null ? p : { brief: args }
    } catch {
      return { brief: args }
    }
  }
  return typeof args === "object" ? args : {}
})()

const brief = String(_a.brief ?? "").trim()
if (!brief) throw new Error("args.brief is required")

phase("Guard")
if (_a.approved !== true && _a.approved !== "true") {
  return {
    ok: false,
    needsApproval: true,
    brief,
    message: [
      "Human approval required before product-code apply.",
      "Re-run with: workflow({ operation:'run', name:'evolve-apply', args: { brief: '<path>', approved: true, brief_hash: '<sha256>' } })",
      "Recommended: run evolve-review first, then approve explicitly.",
    ].join("\n"),
  }
}

const expectedHash = String(_a.brief_hash ?? _a.briefHash ?? "").trim().toLowerCase()
if (!expectedHash || expectedHash.length < 16) {
  return {
    ok: false,
    needsApproval: true,
    brief,
    message:
      "args.brief_hash (sha256 of the approved brief file) is required so a tampered brief cannot reuse an old approval.",
  }
}

phase("Load brief")
const hashCheck = await agent(
  [
    "Read the evolve brief file and compute sha256 of its exact bytes.",
    "Return JSON only: { hash: string, title?: string, dangerous: boolean, summary: string }",
    `Brief path: ${brief}`,
    `Expected hash: ${expectedHash}`,
    `allow_dangerous=${_a.allow_dangerous === true || _a.allow_dangerous === "true"}`,
    "Set dangerous=true if the brief touches permissions, auth/secrets, DB migrations, or public API contracts.",
  ].join("\n"),
)

const hashMatch =
  typeof hashCheck === "string" &&
  new RegExp(`"hash"\\s*:\\s*"${expectedHash}"`, "i").test(hashCheck.replace(/\s/g, ""))
if (!hashMatch) {
  // Also accept hash field with whitespace
  const m = typeof hashCheck === "string" ? hashCheck.match(/"hash"\s*:\s*"([a-f0-9]+)"/i) : null
  const got = m?.[1]?.toLowerCase()
  if (!got || got !== expectedHash) {
    return {
      ok: false,
      needsApproval: true,
      brief,
      message: `Brief hash mismatch — approval is bound to a specific brief version. expected=${expectedHash} got=${got ?? "unknown"}`,
      hashCheck,
    }
  }
}

const dangerBlocked =
  typeof hashCheck === "string" &&
  /"dangerous"\s*:\s*true/.test(hashCheck) &&
  !(_a.allow_dangerous === true || _a.allow_dangerous === "true")

if (dangerBlocked) {
  return {
    ok: false,
    needsApproval: true,
    brief,
    message:
      "Brief marked dangerous (permissions/auth/schema/API). Re-run with allow_dangerous:true only after explicit human OK.",
    loaded: hashCheck,
  }
}

phase("Implement")
const branchHint = _a.branch ? `Use branch name hint: ${_a.branch}` : "Choose a short branch name evolve/<slug>."
const implemented = await agent(
  [
    "You are applying an oimo PRODUCT change from an evolve brief.",
    "Work only on acceptance criteria. Do not expand scope.",
    "Create commits on a feature branch. Prefer small, reviewable diffs.",
    "Do NOT push with --force. Do NOT merge to main.",
    branchHint,
    "",
    "Brief context:",
    hashCheck,
  ].join("\n"),
  { isolation: "worktree", label: "evolve-apply", phase: "Implement" },
)

phase("Verify")
const verified = await agent(
  [
    "Verify the evolve-apply changes.",
    "From packages/opencode run: bun typecheck",
    "Run the most relevant bun test files for touched areas.",
    "If evolve_status tool is available, call operation=gate.",
    "Return JSON: { typecheck: 'pass'|'fail', tests: 'pass'|'fail'|'skipped', gate: 'pass'|'fail'|'inconclusive'|'n/a', notes: string }",
    "",
    "Implementation summary:",
    implemented,
  ].join("\n"),
  { label: "evolve-verify", phase: "Verify" },
)

function parseVerify(v) {
  if (v && typeof v === "object") return v
  if (typeof v !== "string") return null
  const m = v.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0])
  } catch {
    return null
  }
}

const verifyObj = parseVerify(verified)
const blockedStatuses = new Set(["fail", "skipped", "not_run", "inconclusive"])
const verifyFailed =
  !verifyObj ||
  verifyObj.typecheck === "fail" ||
  verifyObj.tests === "fail" ||
  blockedStatuses.has(String(verifyObj.gate ?? ""))

if (verifyFailed) {
  return {
    ok: false,
    brief,
    verified,
    message:
      "Verify/gate did not pass (fail|skipped|not_run|inconclusive). Refusing to open a PR. Fix failures and re-run evolve-apply.",
  }
}

phase("PR")
const title = _a.title ? String(_a.title) : undefined
const pr = await agent(
  [
    "Open a DRAFT pull request for the evolve-apply branch (gh pr create --draft).",
    "PR body must include: Summary, Brief path, brief_hash, Acceptance criteria checklist, Test plan, Rollback notes.",
    title ? `Title: ${title}` : "Title: derive from brief title prefixed with 'evolve:'",
    "Do not merge. Return the PR URL.",
    "",
    "Verify result:",
    verified,
  ].join("\n"),
  { label: "evolve-pr", phase: "PR" },
)

return {
  ok: true,
  brief,
  brief_hash: expectedHash,
  approval_event_id: _a.approval_event_id ?? _a.approvalEventId ?? null,
  loaded: hashCheck,
  verified,
  pr,
  note: "Draft PR only — human merge required. Use git revert / PR close to rollback product changes.",
}

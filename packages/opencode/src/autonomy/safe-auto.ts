/**
 * safe_auto permission preset (FDE/SE §9.1).
 * Not allow-all: routine workspace work may auto-pass; high-risk stays human-gated.
 */
import type { Info as PermissionInfo } from "@/config/permission"
import type { AutonomyPermissionPreset } from "./resolve"

/** Base rules merged UNDER user config (user deny still wins). */
export function safeAutoPermissionConfig(): PermissionInfo {
  return {
    read: "allow",
    glob: "allow",
    grep: "allow",
    list: "allow",
    lsp: "allow",
    codesearch: "allow",
    skill: "allow",
    question: "allow",
    // Edits inside the workspace are the SE/FDE default path; external_directory stays ask.
    edit: "allow",
    // Bash stays ask so destructive / network / cloud intents surface; forced-ask covers deletes.
    bash: "ask",
    external_directory: "ask",
    webfetch: "ask",
    websearch: "ask",
    task: "ask",
    actor: "ask",
    doom_loop: "ask",
  }
}

export function fullAutoPermissionConfig(): PermissionInfo {
  return { "*": "allow" }
}

export function permissionConfigForPreset(preset: AutonomyPermissionPreset): PermissionInfo {
  if (preset === "interactive") return {}
  if (preset === "full_auto") return fullAutoPermissionConfig()
  return safeAutoPermissionConfig()
}

/** Permissions that must never be auto-approved under safe_auto (beyond FORCED_ASK). */
export const SAFE_AUTO_ALWAYS_ASK = new Set([
  "bash_delete",
  "external_directory",
  "doom_loop",
  "webfetch",
  "websearch",
])

/** Intents that require a structured high_risk_action AutonomyGate (FDE/SE §9). */
export const HIGH_RISK_PERMISSIONS = new Set([
  "bash_delete",
  "external_directory",
  "webfetch",
  "websearch",
  "doom_loop",
])

export function requiresHighRiskGate(permission: string): boolean {
  return HIGH_RISK_PERMISSIONS.has(permission)
}

export function safeAutoMayAutoAllow(permission: string): boolean {
  if (SAFE_AUTO_ALWAYS_ASK.has(permission)) return false
  return (
    permission === "read" ||
    permission === "glob" ||
    permission === "grep" ||
    permission === "list" ||
    permission === "lsp" ||
    permission === "codesearch" ||
    permission === "skill" ||
    permission === "question" ||
    permission === "edit"
  )
}

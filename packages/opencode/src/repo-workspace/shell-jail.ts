/**
 * Optional OS-level filesystem allowlist for multi-repo mutating shell.
 * When bubblewrap is unavailable, callers must treat commands as policy-only
 * and never classify unparsed write vectors as safe.
 */

import { AppFileSystem } from "@mimo-ai/shared/filesystem"

export function hasBubblewrap() {
  return Boolean(Bun.which("bwrap"))
}

export type JailPlan =
  | { mode: "bwrap"; argv: string[]; binary: string }
  | { mode: "policy-only"; reason: string }

/**
 * Build a bubblewrap jail that keeps the filesystem read-only except for
 * explicit writable roots (registered repo roots in execution scope).
 */
export function planJail(input: {
  shell: string
  command: string
  cwd: string
  writableRoots: string[]
}): JailPlan {
  const binary = Bun.which("bwrap")
  if (!binary) {
    return {
      mode: "policy-only",
      reason: "bubblewrap (bwrap) not available; multi-repo shell relies on Policy path checks only",
    }
  }

  const roots = [...new Set(input.writableRoots.map((r) => AppFileSystem.resolve(r)).filter(Boolean))]
  if (!roots.length) {
    return { mode: "policy-only", reason: "no writable roots for OS sandbox" }
  }

  const cwd = AppFileSystem.resolve(input.cwd)
  const argv = [
    "--die-with-parent",
    "--unshare-pid",
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
  ]
  for (const root of roots) {
    argv.push("--bind", root, root)
  }
  // Ensure cwd is reachable even if it is a subdir of a bound root (already covered)
  // or itself needs an explicit bind.
  if (!roots.some((r) => cwd === r || cwd.startsWith(r.endsWith("/") ? r : r + "/"))) {
    argv.push("--bind", cwd, cwd)
  }
  argv.push("--chdir", cwd, "--", input.shell, "-lc", input.command)
  return { mode: "bwrap", argv, binary }
}

/** High-risk write tokens that must never be treated as safe when jail is policy-only. */
const OPAQUE_WRITE =
  /\b(tee|dd|install|cp|mv|rsync|sed\s+-i|perl\s+-i|ruby\s+-i|python[23]?\s+-c|node\s+-e|sqlite3|truncate)\b/i

export function looksLikeOpaqueWrite(command: string) {
  return OPAQUE_WRITE.test(command)
}

/**
 * When OS sandbox is missing, refuse opaque write vectors unless every scanned
 * path already passed Policy (caller passes pathCovered=true only then).
 */
export function assertPolicyOnlySafe(input: {
  command: string
  pathCovered: boolean
  jail: JailPlan
}): { ok: true } | { ok: false; message: string } {
  if (input.jail.mode === "bwrap") return { ok: true }
  if (!looksLikeOpaqueWrite(input.command)) return { ok: true }
  if (input.pathCovered) return { ok: true }
  return {
    ok: false,
    message:
      "repo-workspace shell denied (no_os_sandbox): opaque write command without fully Policy-covered paths. Install bubblewrap or use file tools.",
  }
}

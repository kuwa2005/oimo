/**
 * Pure CLI autonomy flag parse (FDE/SE §11.1) — no process spawn, no Flag import.
 */
import { resolveAutonomyRequest, type AutonomyRequest, type AutonomyResolveResult } from "../autonomy/resolve"

export type AutonomyCliFlags = {
  se: boolean
  fde: boolean
  spauto: boolean
  auto: boolean
  dangerouslySkipPermissions: boolean
}

/** Scan argv for autonomy-related flags (boolean presence only). */
export function parseAutonomyCliFlags(argv: readonly string[]): AutonomyCliFlags {
  const set = new Set(argv)
  return {
    se: set.has("--se") || set.has("--autonomy"),
    fde: set.has("--fde"),
    spauto: set.has("--spauto") || set.has("--autosp"),
    auto: set.has("--auto") || set.has("--yolo"),
    dangerouslySkipPermissions: set.has("--dangerously-skip-permissions"),
  }
}

export function resolveAutonomyFromArgv(
  argv: readonly string[],
  source: "cli" | "session_list" | "tui" = "cli",
): AutonomyResolveResult {
  const flags = parseAutonomyCliFlags(argv)
  return resolveAutonomyRequest({
    source,
    se: flags.se,
    fde: flags.fde,
    spauto: flags.spauto,
  })
}

export type { AutonomyRequest }

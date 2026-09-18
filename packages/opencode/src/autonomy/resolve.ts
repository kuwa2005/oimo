/**
 * Canonical AutonomyRequest resolver (FDE/SE improvement §5.1 / §7.1).
 * Pure function — no process.env mutation, no Flag import-time reads.
 */
export type AutonomyProfile = "off" | "se" | "fde" | "super_auto"

export type LearningLens = "se" | "fde"

export type AutonomyPermissionPreset = "interactive" | "safe_auto" | "full_auto"

export type AutonomyRequestSource = "cli" | "session_list" | "config" | "tui"

export type AutonomyRequest = {
  profile: AutonomyProfile
  learningLenses: LearningLens[]
  source: AutonomyRequestSource
  permissionPreset: AutonomyPermissionPreset
}

export type AutonomyResolveInput = {
  source: AutonomyRequestSource
  /** CLI / forwarded flags */
  se?: boolean
  fde?: boolean
  spauto?: boolean
  /** Legacy Mode from config or /auto */
  configMode?: "none" | "normal" | "special" | "fde" | "se" | "off" | "super_auto"
  /** Explicit env snapshot (not live process.env) */
  env?: {
    MIMOCODE_AUTONOMY?: string
    MIMOCODE_FDE?: string
    MIMOCODE_SPAUTO?: string
  }
}

export type AutonomyResolveResult = {
  request: AutonomyRequest
  warnings: string[]
  errors: string[]
}

function truthy(v: string | undefined) {
  if (!v) return false
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes"
}

function fromLegacyMode(mode: NonNullable<AutonomyResolveInput["configMode"]>): {
  profile: AutonomyProfile
  lenses: LearningLens[]
  permission: AutonomyPermissionPreset
} {
  if (mode === "none" || mode === "off") {
    return { profile: "off", lenses: [], permission: "interactive" }
  }
  if (mode === "special" || mode === "super_auto") {
    return { profile: "super_auto", lenses: [], permission: "full_auto" }
  }
  if (mode === "fde") {
    return { profile: "fde", lenses: ["fde"], permission: "safe_auto" }
  }
  // normal | se
  return { profile: "se", lenses: ["se"], permission: "safe_auto" }
}

/**
 * Resolve all entry points to one AutonomyRequest.
 * Priority: explicit CLI flags > env snapshot > configMode.
 * `--se --fde` → profile=fde, learningLenses=["se","fde"] (all sources).
 */
export function resolveAutonomyRequest(input: AutonomyResolveInput): AutonomyResolveResult {
  const warnings: string[] = []
  const errors: string[] = []

  const se = Boolean(input.se) || truthy(input.env?.MIMOCODE_AUTONOMY)
  const fde = Boolean(input.fde) || truthy(input.env?.MIMOCODE_FDE)
  const spauto = Boolean(input.spauto) || truthy(input.env?.MIMOCODE_SPAUTO)

  if (input.configMode === "normal") {
    warnings.push("alias: configMode 'normal' maps to profile 'se'")
  }

  // CLI / session_list / tui flag path
  if (se || fde || spauto) {
    if (spauto && (se || fde)) {
      warnings.push("spauto dominates se/fde flags; profile=super_auto")
    }
    if (spauto) {
      return {
        request: {
          profile: "super_auto",
          learningLenses: [],
          source: input.source,
          permissionPreset: "full_auto",
        },
        warnings,
        errors,
      }
    }
    if (se && fde) {
      // Canonical combined rule for ALL sources (closes blocker #5)
      return {
        request: {
          profile: "fde",
          learningLenses: ["se", "fde"],
          source: input.source,
          permissionPreset: "safe_auto",
        },
        warnings,
        errors,
      }
    }
    if (fde) {
      return {
        request: {
          profile: "fde",
          learningLenses: ["fde"],
          source: input.source,
          permissionPreset: "safe_auto",
        },
        warnings,
        errors,
      }
    }
    return {
      request: {
        profile: "se",
        learningLenses: ["se"],
        source: input.source,
        permissionPreset: "safe_auto",
      },
      warnings,
      errors,
    }
  }

  if (input.configMode) {
    const mapped = fromLegacyMode(input.configMode)
    return {
      request: {
        profile: mapped.profile,
        learningLenses: mapped.lenses,
        source: input.source,
        permissionPreset: mapped.permission,
      },
      warnings,
      errors,
    }
  }

  return {
    request: {
      profile: "off",
      learningLenses: [],
      source: input.source,
      permissionPreset: "interactive",
    },
    warnings,
    errors,
  }
}

/** Temporary bridge until Mode is deleted. */
export function legacyModeFromProfile(profile: AutonomyProfile): "none" | "normal" | "special" | "fde" {
  if (profile === "off") return "none"
  if (profile === "super_auto") return "special"
  if (profile === "fde") return "fde"
  return "normal"
}

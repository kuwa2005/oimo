const BUILTIN = new Set([
  "init",
  "review",
  "dream",
  "distill",
  "evolve",
  "self-improve",
  "goal",
  "deep-research",
  "loops",
  "rebuild",
])

export function slashCommandDescription(
  t: (key: string) => string,
  name: string,
  fallback?: string,
) {
  if (!BUILTIN.has(name)) return fallback
  const translated = t(`tui.slash.${name}.description`)
  return translated || fallback
}

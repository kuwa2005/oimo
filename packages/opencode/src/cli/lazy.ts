/**
 * Defer loading heavy CommandModules until a command is selected.
 * Top-level `--help` only needs `command` + `describe` (and the default
 * command's builder for shared flags) — not Run/TUI/server graphs.
 */
import type { Argv, CommandModule } from "yargs"

export function lazyCommand<T = {}, U = {}>(
  stub: Pick<CommandModule<T, U>, "command" | "describe" | "aliases">,
  load: () => Promise<CommandModule<T, U>>,
): CommandModule<T, U> {
  let cached: CommandModule<T, U> | undefined
  const resolve = async () => {
    if (!cached) cached = await load()
    return cached
  }
  return {
    command: stub.command,
    describe: stub.describe,
    aliases: stub.aliases,
    builder: async (yargs: Argv) => {
      const mod = await resolve()
      if (typeof mod.builder === "function") {
        return (await mod.builder(yargs as Argv<T>)) as Argv<U>
      }
      return yargs as Argv<U>
    },
    handler: async (args) => {
      const mod = await resolve()
      if (mod.handler) return mod.handler(args)
    },
  }
}

/** True when argv is only asking for help/version (no real command work). */
export function isHelpOrVersionOnly(argv: string[]) {
  if (argv.length === 0) return false
  const flags = new Set(["-h", "--help", "-v", "--version"])
  return argv.every((a) => flags.has(a))
}

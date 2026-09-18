/**
 * Thin CLI entry — bare `--help` / `--version` never load Config, DB, TUI, or util barrel.
 */
import { hideBin } from "yargs/helpers"
import { isHelpOrVersionOnly } from "./cli/lazy"

const args = hideBin(process.argv)

if (isHelpOrVersionOnly(args)) {
  const { runMetaCli } = await import("./cli/meta-cli")
  await runMetaCli(args)
  process.exit(0)
}

await import("./cli/main")

import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { ManagedRuntime } from "effect"
import { Installation } from "../../installation"
import { InstallationVersion } from "../../installation/version"

// Upgrade must not boot the full AppRuntime: orphan recovery / File / Inbox
// layers expect an Instance ALS that CLI upgrade never establishes.
const InstallationRuntime = ManagedRuntime.make(Installation.defaultLayer)

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: "oimo を最新版または指定したバージョンにアップグレードします",
  builder: (yargs: Argv) => {
    return yargs
      .positional("target", {
        describe: "アップグレード先のバージョン (例: '0.1.48' または 'v0.1.48')",
        type: "string",
      })
      .option("method", {
        alias: "m",
        describe: "使用するインストール方法",
        type: "string",
        choices: ["curl", "npm", "pnpm", "bun", "brew", "choco", "scoop"],
      })
  },
  handler: async (args: { target?: string; method?: string }) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    const detectedMethod = await InstallationRuntime.runPromise(Installation.Service.use((svc) => svc.method()))
    const method = (args.method as Installation.Method) ?? detectedMethod
    if (method === "unknown") {
      prompts.log.error(`oimo is installed to ${process.execPath} and may be managed by a package manager`)
      const install = await prompts.select({
        message: "Install anyways?",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
        initialValue: false,
      })
      if (!install) {
        prompts.outro("Done")
        return
      }
    }
    prompts.log.info("Using method: " + method)
    const target = args.target
      ? args.target.replace(/^v/, "")
      : await InstallationRuntime.runPromise(Installation.Service.use((svc) => svc.latest()))

    if (InstallationVersion === target) {
      prompts.log.warn(`oimo upgrade skipped: ${target} is already installed`)
      prompts.outro("Done")
      return
    }

    prompts.log.info(`From ${InstallationVersion} → ${target}`)
    const spinner = prompts.spinner()
    spinner.start("Upgrading...")
    const err = await InstallationRuntime.runPromise(
      Installation.Service.use((svc) => svc.upgrade(method, target)),
    ).catch((err) => err)
    if (err) {
      spinner.stop("Upgrade failed", 1)
      if (err instanceof Installation.UpgradeFailedError) {
        // necessary because choco only allows install/upgrade in elevated terminals
        if (method === "choco" && err.stderr.includes("not running from an elevated command shell")) {
          prompts.log.error("Please run the terminal as Administrator and try again")
        } else {
          prompts.log.error(err.stderr)
        }
      } else if (err instanceof Error) prompts.log.error(err.message)
      prompts.outro("Done")
      return
    }
    spinner.stop("Upgrade complete")
    prompts.outro("Done")
  },
}

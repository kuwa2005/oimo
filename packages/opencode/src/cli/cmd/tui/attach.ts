import { cmd } from "../cmd"
import { UI } from "@/cli/ui"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { TuiConfig } from "@/cli/cmd/tui/config/tui"

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "実行中の oimo サーバーに接続する",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "接続先 URL (例: http://localhost:4096)",
        demandOption: true,
      })
      .option("dir", {
        type: "string",
        description: "directory to run in",
      })
      .option("continue", {
        alias: ["c"],
        describe: "最後のセッションを続行する",
        type: "boolean",
      })
      .option("warm", {
        describe:
          "ソフト continue: このディレクトリの直近セッションから要約だけ継承した新規セッション (--warm=deep で compaction 境界まで)",
        type: "string",
        coerce: (value: string | boolean | undefined) => {
          if (value === undefined || value === false) return undefined
          if (value === true || value === "") return "summary"
          if (value === "deep" || value === "summary") return value
          return "summary"
        },
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "続行するセッション ID",
      })
      .option("fork", {
        type: "boolean",
        describe: "続行時にセッションをフォークする (--continue または --session と併用)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "Basic 認証パスワード (既定は MIMOCODE_SERVER_PASSWORD)",
      }),
  handler: async (args) => {
    const unguard = win32InstallCtrlCGuard()
    try {
      win32DisableProcessedInput()

      if (args.fork && !args.continue && !args.session && !args.warm) {
        UI.error("--fork requires --continue, --warm, or --session")
        process.exitCode = 1
        return
      }

      if (args.continue && args.warm) {
        UI.error("--continue and --warm cannot be used together")
        process.exitCode = 1
        return
      }

      const directory = (() => {
        if (!args.dir) return undefined
        try {
          process.chdir(args.dir)
          return process.cwd()
        } catch {
          // If the directory doesn't exist locally (remote attach), pass it through.
          return args.dir
        }
      })()
      const headers = (() => {
        const password = args.password ?? process.env.MIMOCODE_SERVER_PASSWORD
        if (!password) return undefined
        const username = process.env.MIMOCODE_SERVER_USERNAME ?? "oimo"
        const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
        return { Authorization: auth }
      })()
      const config = await TuiConfig.get()
      const { tui } = await import("./app")
      await tui({
        url: args.url,
        config,
        args: {
          continue: args.continue,
          warm: args.warm,
          sessionID: args.session,
          fork: args.fork,
        },
        directory,
        headers,
      })
    } finally {
      unguard?.()
    }
  },
})

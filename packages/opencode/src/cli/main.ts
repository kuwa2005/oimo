import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { Log } from "../util"
import { UI } from "./ui"
import { Installation } from "../installation"
import { InstallationVersion } from "../installation/version"
import { NamedError } from "@mimo-ai/shared/util/error"
import { FormatError } from "./error"
import { Filesystem } from "../util"
import { EOL } from "os"
import path from "path"
import { readdirSync, unlinkSync } from "fs"
import { Global } from "../global"
import { errorMessage } from "../util/error"
import { ensureProcessMetadata } from "../util/mimo-process"
import { isHelpOrVersionOnly, lazyCommand } from "./lazy"
import { withTuiLaunchOptions } from "./cmd/tui/tui-launch-options"

const processMetadata = ensureProcessMetadata("main")

process.on("unhandledRejection", (e) => {
  Log.Default.error("rejection", {
    e: errorMessage(e),
  })
})

process.on("uncaughtException", (e) => {
  Log.Default.error("exception", {
    e: errorMessage(e),
  })
})

const args = hideBin(process.argv)
const CLI_EXIT = Symbol("CLI_EXIT")
const helpOrVersionOnly = isHelpOrVersionOnly(args) || args.includes("-h") || args.includes("--help")

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("oimo ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(UI.withTrailingEOL(text))
    return
  }
  process.stderr.write(UI.withTrailingEOL(out))
}

const cli = yargs(args)
  .locale("ja")
  .parserConfiguration({ "populate--": true })
  .scriptName("oimo")
  .wrap(100)
  .help("help")
  .alias("help", "h")
  .version("version", InstallationVersion)
  .alias("version", "v")
  .option("print-logs", {
    describe: "ログを stderr に出力する",
    type: "boolean",
  })
  .option("log-level", {
    describe: "ログレベル",
    type: "string",
    choices: ["DEBUG", "INFO", "WARN", "ERROR"],
  })
  .option("pure", {
    describe: "外部プラグインなしで実行する",
    type: "boolean",
  })
  .option("tor", {
    describe: "すべてのネットワーク通信を Tor SOCKS5 プロキシ経由にする",
    type: "boolean",
  })
  .option("uuid", {
    describe: "起動ごとに installation UUID をランダム生成する (永続 ID を使わない)",
    type: "boolean",
  })
  .option("log", {
    describe:
      "TUI セッションログをマークダウンに追記 (既定: ON。.oimo/oimo-session-<タイムスタンプ>.md。パス指定で上書き)",
    type: "string",
  })
  .option("no-log", {
    describe: "セッションログを無効にする (既定の --log をオフ)",
    type: "boolean",
  })
  .option("log-mode", {
    describe: "--log ファイルの内容 (既定: summary)",
    type: "string",
    choices: ["full", "summary"],
  })
  .middleware(async (opts) => {
    // FDE/SE §11.2: never mix DB migration / Claude import / Tor with help generation.
    if (helpOrVersionOnly || opts.help || opts.version) return

    if (opts.pure) {
      process.env.MIMOCODE_PURE = "1"
    }

    if (opts.tor) {
      process.env.MIMOCODE_TOR = "1"
    }

    if (opts.uuid) {
      process.env.MIMOCODE_RANDOM_UUID = "1"
    }

    if (opts.noLog) {
      delete process.env.MIMOCODE_LOG
      delete process.env.MIMOCODE_LOG_AUTO
    } else if (typeof opts.log === "string" && opts.log.length > 0) {
      process.env.MIMOCODE_LOG = path.resolve(opts.log)
      delete process.env.MIMOCODE_LOG_AUTO
    } else if (!process.env.MIMOCODE_LOG) {
      // Default ON (also covers bare `--log` / `--log=`): auto file under ./.oimo/
      process.env.MIMOCODE_LOG_AUTO = "1"
    }

    if (opts.logMode) {
      process.env.MIMOCODE_LOG_MODE = opts.logMode
    }

    await Log.init({
      print: process.argv.includes("--print-logs"),
      dev: Installation.isLocal(),
      level: (() => {
        if (opts.logLevel) return opts.logLevel as Log.Level
        if (Installation.isLocal()) return "DEBUG"
        return "INFO"
      })(),
    })

    const [{ Heap }, { initTor }] = await Promise.all([import("./heap"), import("../util/tor")])
    Heap.start()
    await initTor()

    process.env.AGENT = "1"
    process.env.MIMOCODE = "1"
    process.env.MIMOCODE_PID = String(process.pid)

    Log.Default.info("oimo", {
      version: InstallationVersion,
      args: process.argv.slice(2),
      process_role: processMetadata.processRole,
      run_id: processMetadata.runID,
    })

    const marker = path.join(Global.Path.data, "oimo.db")
    if (!(await Filesystem.exists(marker))) {
      const { JsonMigration, Database } = await import("../storage")
      const { drizzle } = await import("drizzle-orm/bun-sqlite")
      const tty = process.stderr.isTTY
      process.stderr.write("Performing one time database migration, may take a few minutes..." + EOL)
      const width = 36
      const orange = "\x1b[38;5;214m"
      const muted = "\x1b[0;2m"
      const reset = "\x1b[0m"
      let last = -1
      if (tty) process.stderr.write("\x1b[?25l")
      try {
        await JsonMigration.run(drizzle({ client: Database.Client().$client }), {
          progress: (event) => {
            const percent = Math.floor((event.current / event.total) * 100)
            if (percent === last && event.current !== event.total) return
            last = percent
            if (tty) {
              const fill = Math.round((percent / 100) * width)
              const bar = `${"■".repeat(fill)}${"･".repeat(width - fill)}`
              process.stderr.write(
                `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.label.padEnd(12)} ${event.current}/${event.total}${reset}`,
              )
              if (event.current === event.total) process.stderr.write("\n")
            } else {
              process.stderr.write(`sqlite-migration:${percent}${EOL}`)
            }
          },
        })
      } finally {
        if (tty) process.stderr.write("\x1b[?25h")
        else {
          process.stderr.write(`sqlite-migration:done${EOL}`)
        }
      }
      process.stderr.write("Database migration complete." + EOL)
    }

    // Idempotently import Claude Code sessions into SQLite. Runs once per process
    // tree (the env guard is inherited by spawned children) and is best-effort:
    // a failure here must never block command startup.
    if (!process.env.MIMOCODE_DISABLE_CLAUDE_IMPORT && !process.env.MIMOCODE_CLAUDE_IMPORTED) {
      process.env.MIMOCODE_CLAUDE_IMPORTED = "1"
      try {
        const { ClaudeImport } = await import("../session/claude-import")
        await ClaudeImport.run()
      } catch (e) {
        Log.Default.warn("claude-import failed", { e: errorMessage(e) })
      }
    }

    // Clean up stale .old_* files left by Windows in-place upgrades
    if (process.platform === "win32") {
      try {
        const binDir = path.dirname(process.execPath)
        for (const entry of readdirSync(binDir)) {
          if (entry.startsWith("oimo.exe.old_")) {
            try {
              unlinkSync(path.join(binDir, entry))
            } catch {}
          }
        }
      } catch {}
    }
  })
  .usage("oimo <コマンド> [オプション]")
  .example("oimo", "TUI を起動する")
  .example("oimo -c --auto --se", "最後のセッションを自動許可 + SE 自律モードで続行する")
  .example("oimo --se --character", "SE 自律 + 愚痴モード (Friction フィードバック表示) で起動する")
  .example("oimo --spauto", "Super Auto で起動する (ヒアリングなし・完全ノンストップ)")
  .example("oimo --compliance", "入力シークレットをマスクして起動する (企業向け・既定オフ)")
  .example('oimo run "バグを修正して"', "ヘッドレスで 1 回のプロンプトを実行する")
  .example("oimo session list", "セッションの一覧を表示する")
  .completion("completion", "シェルの補完スクリプトを生成する")
  .command(
    lazyCommand({ command: "acp", describe: "ACP (Agent Client Protocol) サーバーを起動" }, () =>
      import("./cmd/acp").then((m) => m.AcpCommand),
    ),
  )
  .command(
    lazyCommand({ command: "mcp", describe: "MCP (Model Context Protocol) サーバーを管理する" }, () =>
      import("./cmd/mcp").then((m) => m.McpCommand),
    ),
  )
  .command({
    command: "$0 [project]",
    describe: "oimo TUI を起動する",
    builder: (yargs) => withTuiLaunchOptions(yargs),
    handler: async (args) => {
      const { TuiThreadCommand } = await import("./cmd/tui/thread")
      return TuiThreadCommand.handler!(args)
    },
  })
  .command(
    lazyCommand({ command: "attach <url>", describe: "実行中の oimo サーバーに接続する" }, () =>
      import("./cmd/tui/attach").then((m) => m.AttachCommand),
    ),
  )
  .command(
    lazyCommand({ command: "run [message..]", describe: "メッセージを渡して oimo を実行する" }, () =>
      import("./cmd/run").then((m) => m.RunCommand),
    ),
  )
  .command(
    lazyCommand({ command: "generate", describe: false as unknown as string }, () =>
      import("./cmd/generate").then((m) => m.GenerateCommand),
    ),
  )
  .command(
    lazyCommand({ command: "debug", describe: "デバッグ・トラブルシューティング用ツール" }, () =>
      import("./cmd/debug").then((m) => m.DebugCommand),
    ),
  )
  .command(
    lazyCommand({ command: "console", describe: false as unknown as string }, () =>
      import("./cmd/account").then((m) => m.ConsoleCommand),
    ),
  )
  .command(
    lazyCommand(
      {
        command: "providers",
        aliases: ["auth"],
        describe: "AI プロバイダと資格情報を管理する",
      },
      () => import("./cmd/providers").then((m) => m.ProvidersCommand),
    ),
  )
  .command(
    lazyCommand({ command: "agent", describe: "エージェントを管理する" }, () =>
      import("./cmd/agent").then((m) => m.AgentCommand),
    ),
  )
  .command(
    lazyCommand(
      { command: "upgrade [target]", describe: "oimo を最新版または指定したバージョンにアップグレードします" },
      () => import("./cmd/upgrade").then((m) => m.UpgradeCommand),
    ),
  )
  .command(
    lazyCommand(
      { command: "uninstall", describe: "oimo をアンインストールし、関連ファイルをすべて削除します" },
      () => import("./cmd/uninstall").then((m) => m.UninstallCommand),
    ),
  )
  .command(
    lazyCommand({ command: "serve", describe: "ヘッドレス oimo サーバーを起動します" }, () =>
      import("./cmd/serve").then((m) => m.ServeCommand),
    ),
  )
  .command(
    lazyCommand(
      {
        command: "llm-server",
        describe: "このインスタンスのモデルへタスクが到達するための認証情報を発行・管理する",
      },
      () => import("./cmd/llm-server").then((m) => m.LlmServerCommand),
    ),
  )
  .command(
    lazyCommand({ command: "models [provider]", describe: "利用可能なすべてのモデルを一覧表示します" }, () =>
      import("./cmd/models").then((m) => m.ModelsCommand),
    ),
  )
  .command(
    lazyCommand({ command: "stats", describe: "トークン使用量とコストの統計を表示" }, () =>
      import("./cmd/stats").then((m) => m.StatsCommand),
    ),
  )
  .command(
    lazyCommand(
      { command: "export [sessionID]", describe: "セッションデータを JSON としてエクスポートします" },
      () => import("./cmd/export").then((m) => m.ExportCommand),
    ),
  )
  .command(
    lazyCommand(
      { command: "import <file>", describe: "JSON ファイルまたは URL からセッションデータをインポートします" },
      () => import("./cmd/import").then((m) => m.ImportCommand),
    ),
  )
  .command(
    lazyCommand({ command: "github", describe: "GitHub エージェントを管理" }, () =>
      import("./cmd/github").then((m) => m.GithubCommand),
    ),
  )
  .command(
    lazyCommand(
      {
        command: "pr <number>",
        describe: "GitHub PR のブランチを取得してチェックアウトし、oimo を実行します",
      },
      () => import("./cmd/pr").then((m) => m.PrCommand),
    ),
  )
  .command(
    lazyCommand({ command: "session", describe: "セッションを管理する" }, () =>
      import("./cmd/session").then((m) => m.SessionCommand),
    ),
  )
  .command(
    lazyCommand({ command: "plugin <module>", describe: "プラグインをインストールして設定を更新" }, () =>
      import("./cmd/plug").then((m) => m.PluginCommand),
    ),
  )
  .command(
    lazyCommand(
      {
        command: "repos",
        describe:
          "マルチリポジトリ Workspace（list / doctor / status / graph / impact / plan / approve / reject / verify / change-set）",
      },
      () => import("./cmd/repos").then((m) => m.ReposCommand),
    ),
  )
  .command(
    lazyCommand({ command: "db", describe: "データベース ツール" }, () =>
      import("./cmd/db").then((m) => m.DbCommand),
    ),
  )
  .fail((msg, err) => {
    if (
      msg?.startsWith("未知の引数です") ||
      msg?.startsWith("オプションではない引数が") ||
      msg?.startsWith("不正な値です")
    ) {
      if (err) throw err
      if (msg) {
        process.stderr.write(UI.Style.TEXT_DANGER_BOLD + msg + UI.Style.TEXT_NORMAL + EOL)
        process.stderr.write("ヒント: `oimo --help` でコマンドとオプションを確認できます。" + EOL)
      }
      cli.showHelp(show)
    }
    if (err) throw err
    void Log.exit(1)
    throw CLI_EXIT
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  if (e !== CLI_EXIT) {
    let data: Record<string, any> = {}
    if (e instanceof NamedError) {
      const obj = e.toObject()
      Object.assign(data, {
        ...obj.data,
      })
    }

    if (e instanceof Error) {
      Object.assign(data, {
        name: e.name,
        message: e.message,
        cause: e.cause?.toString(),
        stack: e.stack,
      })
    }

    if (e instanceof ResolveMessage) {
      Object.assign(data, {
        name: e.name,
        message: e.message,
        code: e.code,
        specifier: e.specifier,
        referrer: e.referrer,
        position: e.position,
        importKind: e.importKind,
      })
    }
    Log.Default.error("fatal", data)
    const formatted = FormatError(e)
    if (formatted) UI.error(formatted)
    if (formatted === undefined) {
      UI.error("Unexpected error, check log file at " + Log.file() + " for more details" + EOL)
      process.stderr.write(errorMessage(e) + EOL)
    }
  }
  process.exitCode = 1
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  await Log.shutdown()
  process.exit()
}

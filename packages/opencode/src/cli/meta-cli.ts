/**
 * Bare `--help` / `--version` path — no util barrel, no Config, no DB, no TUI.
 * Target: warm spawn under ~1s (FDE/SE §11.2).
 */
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { EOL } from "os"
import { InstallationVersion } from "../installation/version"
import { isHelpOrVersionOnly, lazyCommand } from "./lazy"
import { withTuiLaunchOptions } from "./cmd/tui/tui-launch-options"

function show(out: string) {
  const text = out.trimStart()
  // Skip logo import for meta path — keep stderr text-only and fast.
  process.stderr.write((text.endsWith("\n") ? text : text + EOL))
}

export async function runMetaCli(argv = hideBin(process.argv)) {
  if (argv.includes("-v") || argv.includes("--version")) {
    if (isHelpOrVersionOnly(argv) || argv.every((a) => ["-v", "--version", "-h", "--help"].includes(a))) {
      process.stdout.write(InstallationVersion + EOL)
      return
    }
  }

  const cli = yargs(argv)
    .locale("ja")
    .parserConfiguration({ "populate--": true })
    .scriptName("oimo")
    .wrap(100)
    .help("help")
    .alias("help", "h")
    .version("version", InstallationVersion)
    .alias("version", "v")
    .option("print-logs", { describe: "ログを stderr に出力する", type: "boolean" })
    .option("log-level", {
      describe: "ログレベル",
      type: "string",
      choices: ["DEBUG", "INFO", "WARN", "ERROR"],
    })
    .option("pure", { describe: "外部プラグインなしで実行する", type: "boolean" })
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
    .option("no-log", { describe: "セッションログを無効にする (既定の --log をオフ)", type: "boolean" })
    .option("log-mode", {
      describe: "--log ファイルの内容 (既定: summary)",
      type: "string",
      choices: ["full", "summary"],
    })
    .usage("oimo <コマンド> [オプション]")
    .example("oimo", "TUI を起動する")
    .example("oimo -c --auto --se", "最後のセッションを自動許可 + SE 自律モードで続行する")
    .example("oimo --se --character", "SE 自律 + 愚痴モード (Friction フィードバック表示) で起動する")
    .example("oimo --spauto", "Super Auto で起動する (ヒアリングなし・完全ノンストップ)")
    .example('oimo run "バグを修正して"', "ヘッドレスで 1 回のプロンプトを実行する")
    .example("oimo session list", "セッションの一覧を表示する")
    .completion("completion", "シェルの補完スクリプトを生成する")
    .command(
      lazyCommand({ command: "acp", describe: "ACP (Agent Client Protocol) サーバーを起動" }, async () => {
        throw new Error("load full CLI for acp")
      }),
    )
    .command(
      lazyCommand({ command: "mcp", describe: "MCP (Model Context Protocol) サーバーを管理する" }, async () => {
        throw new Error("load full CLI for mcp")
      }),
    )
    .command({
      command: "$0 [project]",
      describe: "oimo TUI を起動する",
      builder: (yargs) => withTuiLaunchOptions(yargs),
      handler: async () => {
        throw new Error("load full CLI for TUI")
      },
    })
    .command(lazyCommand({ command: "attach <url>", describe: "実行中の oimo サーバーに接続する" }, async () => {
      throw new Error("load full CLI")
    }))
    .command(lazyCommand({ command: "run [message..]", describe: "メッセージを渡して oimo を実行する" }, async () => {
      throw new Error("load full CLI")
    }))
    .command(lazyCommand({ command: "generate", describe: false as unknown as string }, async () => {
      throw new Error("load full CLI")
    }))
    .command(lazyCommand({ command: "debug", describe: "デバッグ・トラブルシューティング用ツール" }, async () => {
      throw new Error("load full CLI")
    }))
    .command(lazyCommand({ command: "console", describe: false as unknown as string }, async () => {
      throw new Error("load full CLI")
    }))
    .command(
      lazyCommand(
        { command: "providers", aliases: ["auth"], describe: "AI プロバイダと資格情報を管理する" },
        async () => {
          throw new Error("load full CLI")
        },
      ),
    )
    .command(lazyCommand({ command: "agent", describe: "エージェントを管理する" }, async () => {
      throw new Error("load full CLI")
    }))
    .command(
      lazyCommand(
        { command: "upgrade [target]", describe: "oimo を最新版または指定したバージョンにアップグレードします" },
        async () => {
          throw new Error("load full CLI")
        },
      ),
    )
    .command(
      lazyCommand(
        { command: "uninstall", describe: "oimo をアンインストールし、関連ファイルをすべて削除します" },
        async () => {
          throw new Error("load full CLI")
        },
      ),
    )
    .command(lazyCommand({ command: "serve", describe: "ヘッドレス oimo サーバーを起動します" }, async () => {
      throw new Error("load full CLI")
    }))
    .command(
      lazyCommand(
        {
          command: "llm-server",
          describe: "このインスタンスのモデルへタスクが到達するための認証情報を発行・管理する",
        },
        async () => {
          throw new Error("load full CLI")
        },
      ),
    )
    .command(
      lazyCommand({ command: "models [provider]", describe: "利用可能なすべてのモデルを一覧表示します" }, async () => {
        throw new Error("load full CLI")
      }),
    )
    .command(lazyCommand({ command: "stats", describe: "トークン使用量とコストの統計を表示" }, async () => {
      throw new Error("load full CLI")
    }))
    .command(
      lazyCommand(
        { command: "export [sessionID]", describe: "セッションデータを JSON としてエクスポートします" },
        async () => {
          throw new Error("load full CLI")
        },
      ),
    )
    .command(
      lazyCommand(
        {
          command: "import <file>",
          describe: "JSON ファイルまたは URL からセッションデータをインポートします",
        },
        async () => {
          throw new Error("load full CLI")
        },
      ),
    )
    .command(lazyCommand({ command: "github", describe: "GitHub エージェントを管理" }, async () => {
      throw new Error("load full CLI")
    }))
    .command(
      lazyCommand(
        {
          command: "pr <number>",
          describe: "GitHub PR のブランチを取得してチェックアウトし、oimo を実行します",
        },
        async () => {
          throw new Error("load full CLI")
        },
      ),
    )
    .command(lazyCommand({ command: "session", describe: "セッションを管理する" }, async () => {
      throw new Error("load full CLI")
    }))
    .command(
      lazyCommand({ command: "plugin <module>", describe: "プラグインをインストールして設定を更新" }, async () => {
        throw new Error("load full CLI")
      }),
    )
    .command(
      lazyCommand(
        {
          command: "repos",
          describe:
            "マルチリポジトリ Workspace（list / doctor / status / graph / impact / plan / approve / reject / verify / change-set）",
        },
        async () => {
          throw new Error("load full CLI")
        },
      ),
    )
    .command(lazyCommand({ command: "db", describe: "データベース ツール" }, async () => {
      throw new Error("load full CLI")
    }))
    .strict()

  await cli.parse(argv, (err: Error | undefined, _argv: unknown, out: string) => {
    if (err) throw err
    if (!out) return
    show(out)
  })
}

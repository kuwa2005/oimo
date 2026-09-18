/**
 * TUI launch yargs options — kept free of TUI app / worker / config graphs
 * so top-level `oimo --help` stays under the performance budget (FDE/SE §11.2).
 */
import type { Argv } from "yargs"
import { withNetworkOptions } from "@/cli/network-options"
import { CHARACTER_CLI_HELP } from "@/character/mode"

export function withTuiLaunchOptions<T>(yargs: Argv<T>) {
  return withNetworkOptions(yargs)
    .positional("project", {
      type: "string",
      describe: "oimo を起動するディレクトリ",
    })
    .option("model", {
      type: "string",
      alias: ["m"],
      describe: "使用するモデル (provider/model 形式)",
    })
    .option("continue", {
      alias: ["c"],
      describe: "最後のセッションを続行する",
      type: "boolean",
    })
    .option("warm", {
      describe:
        "ソフト continue: このディレクトリの直近セッションから要約だけ継承した新規セッション (--warm=deep で compaction 境界まで履歴継承)",
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
    .option("prompt", {
      type: "string",
      describe: "使用するプロンプト",
    })
    .option("agent", {
      type: "string",
      describe: "使用するエージェント",
    })
    .option("never-ask", {
      type: "boolean",
      describe:
        "never-ask モードで起動する (パーミッションを除き、確認せず自動判断。実行中は /never-ask で切替)",
      default: false,
    })
    .option("autonomy", {
      alias: ["se"],
      type: "boolean",
      describe:
        "SE 自律モード: 要件をヒアリングしてロックしてから、証跡ドキュメント付きでノンストップ実装する (compose エージェントになる)",
      default: false,
    })
    .option("fde", {
      type: "boolean",
      describe:
        "FDE 自律モード: 現場課題を定義し Level1–3 を提案、PoC 後に Solution Lock、実装・検証までノンストップ (compose)。--se と併用可 (Friction Learning を双方視点で実行)",
      default: false,
    })
    .option("character", {
      type: "string",
      requiresArg: false,
      describe: CHARACTER_CLI_HELP,
    })
    .option("spauto", {
      alias: ["autosp"],
      type: "boolean",
      describe:
        "Super Auto: 起動時に赤警告でリスク承認後、ヒアリングなし・完全ノンストップ (compose・never-ask・権限自動承認)。--autosp も可",
      default: false,
    })
    .option("trust", {
      type: "boolean",
      describe: "ワークスペース信頼プロンプトをスキップし、ディレクトリを信頼する",
      default: false,
    })
    .option("dangerously-skip-permissions", {
      type: "boolean",
      describe: "明示的に拒否されていないパーミッションを自動承認する (危険!)",
      default: false,
    })
    .option("auto", {
      alias: ["yolo"],
      type: "boolean",
      describe:
        "明示的に拒否されていないパーミッションを自動承認する (危険!)。ワークスペース信頼プロンプトもスキップする",
      default: false,
    })
}

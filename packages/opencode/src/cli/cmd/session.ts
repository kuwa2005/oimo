import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { Session } from "../../session"
import { ClaudeImport } from "../../session/claude-import"
import { SessionID } from "../../session/schema"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { Locale, Log } from "../../util"
import { Process } from "../../util"
import { Installation } from "../../installation"
import * as prompts from "@clack/prompts"
import { EOL } from "os"
import { AppRuntime } from "@/effect/app-runtime"
import { CHARACTER_CLI_HELP } from "@/character/mode"

export const SessionCommand = cmd({
  command: "session",
  describe: "セッションを管理する",
  builder: (yargs: Argv) =>
    yargs.command(SessionListCommand).command(SessionDeleteCommand).command(SessionImportClaudeCommand).demandCommand(),
  async handler() {},
})

export const SessionImportClaudeCommand = cmd({
  command: "import-claude",
  describe: "Claude Code のセッション (~/.claude/projects) を oimo に取り込む",
  builder: (yargs: Argv) =>
    yargs.option("force", {
      describe: "mtime キャッシュを無視してすべてのセッションを再同期する",
      type: "boolean",
      default: false,
    }),
  handler: async (args) => {
    const stats = await ClaudeImport.run({ force: args.force })
    UI.println(
      `Claude import: scanned ${stats.scanned}, imported ${stats.imported}, resynced ${stats.resynced}, skipped ${stats.skipped}` +
        (stats.errors.length ? `, errors ${stats.errors.length}` : ""),
    )
    for (const err of stats.errors) UI.error(err)
  },
})

export const SessionDeleteCommand = cmd({
  command: "delete <sessionID>",
  describe: "セッションを削除する",
  builder: (yargs: Argv) => {
    return yargs.positional("sessionID", {
      describe: "削除するセッション ID",
      type: "string",
      demandOption: true,
    })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessionID = SessionID.make(args.sessionID)
      try {
        await AppRuntime.runPromise(Session.Service.use((svc) => svc.get(sessionID)))
      } catch {
        UI.error(`Session not found: ${args.sessionID}`)
        await Log.exit(1)
      }
      await AppRuntime.runPromise(Session.Service.use((svc) => svc.remove(sessionID)))
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Session ${args.sessionID} deleted` + UI.Style.TEXT_NORMAL)
    })
  },
})

export const SessionListCommand = cmd({
  command: "list",
  describe: "セッションを一覧表示し、選択して TUI で起動する",
  builder: (yargs: Argv) => {
    return yargs
      .option("max-count", {
        alias: "n",
        describe: "直近 N 件のセッションに限定する",
        type: "number",
      })
      .option("format", {
        describe: "出力形式",
        type: "string",
        choices: ["table", "json"],
        default: "table",
      })
      .option("continue", {
        alias: "c",
        describe: "ピッカーを使わず、直近のセッションを TUI で続行する (--auto/--se/--character などの起動フラグと併用可)",
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
      .option("auto", {
        alias: ["yolo"],
        describe: "選択したセッションを自動許可 (dangerous) で起動する。ワークスペース信頼プロンプトもスキップ",
        type: "boolean",
      })
      .option("autonomy", {
        alias: "se",
        describe: "選択したセッションを SE 自律モード (ヒアリング→要件ロック→自律実装) で起動する",
        type: "boolean",
      })
      .option("fde", {
        describe: "選択したセッションを FDE 自律モード (課題定義→PoC→Solution Lock→実装) で起動する",
        type: "boolean",
      })
      .option("spauto", {
        alias: "autosp",
        describe:
          "選択したセッションを Super Auto で起動する (ヒアリングなし・完全ノンストップ。--autosp も可)",
        type: "boolean",
      })
      .option("character", {
        type: "string",
        requiresArg: false,
        describe: CHARACTER_CLI_HELP,
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const sessions = [...Session.list({ roots: true, limit: args.maxCount })]

      if (sessions.length === 0) {
        if (process.stdout.isTTY) {
          UI.println("セッションが見つかりません。")
          if (args.continue) await Log.exit(1)
        }
        return
      }

      if (args.format === "json") {
        console.log(formatSessionJSON(sessions))
        return
      }

      if (!process.stdout.isTTY) {
        console.log(formatSessionTable(sessions))
        return
      }

      // --se --fde: same canonical rule as TUI (profile=fde, lenses se+fde). Do not reject.
      {
        const { resolveAutonomyFromArgv } = await import("../autonomy-parse")
        const check = resolveAutonomyFromArgv([
          ...(args.autonomy ? ["--se"] : []),
          ...(args.fde ? ["--fde"] : []),
          ...(args.spauto ? ["--spauto"] : []),
        ], "session_list")
        if (check.errors.length) {
          UI.error(check.errors.join("; "))
          await Log.exit(1)
          return
        }
      }
      if (args.continue && args.warm) {
        UI.error("--continue and --warm cannot be used together")
        await Log.exit(1)
        return
      }
      const flags = launchFlags(args)
      if (args.continue) {
        await launchTui(["--continue", ...flags])
        return
      }
      if (args.warm) {
        await launchTui([`--warm=${args.warm}`, ...flags])
        return
      }
      await pickAndLaunch(sessions, flags)
    })
  },
})

export function launchFlags(args: {
  auto?: boolean
  autonomy?: boolean
  fde?: boolean
  spauto?: boolean
  character?: string | boolean
}): string[] {
  const flags: string[] = []
  if (args.auto) flags.push("--auto")
  if (args.autonomy) flags.push("--se")
  if (args.fde) flags.push("--fde")
  if (args.spauto) flags.push("--spauto")
  const character = characterLaunchFlag(args.character)
  if (character) flags.push(character)
  return flags
}

function characterLaunchFlag(raw: string | boolean | undefined): string | undefined {
  if (raw === true || raw === "") return "--character"
  if (typeof raw === "string" && raw.length > 0) return `--character=${raw}`
  return undefined
}

async function pickAndLaunch(sessions: Session.Info[], flags: string[]) {
  const options = [
    { label: "＋ New session", value: "new" },
    ...sessions.map((s) => ({
      label: `${Locale.truncate(s.title, 60)}  ${Locale.todayTimeOrDateTime(s.time.updated)}`,
      value: s.id,
    })),
  ]
  const result = await prompts.select({
    message: "続行するセッションを選択",
    options,
  })
  if (prompts.isCancel(result)) return
  await launchTui(result === "new" ? flags : ["--session", String(result), ...flags])
}

async function launchTui(args: string[]) {
  const bin = process.execPath
  const argv = Installation.isLocal() ? [process.argv[1] ?? "", ...args] : args
  const proc = Process.spawn([bin, ...argv], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  process.exitCode = await proc.exited
}

function formatSessionTable(sessions: Session.Info[]): string {
  const lines: string[] = []

  const maxIdWidth = Math.max(20, ...sessions.map((s) => s.id.length))
  const maxTitleWidth = Math.max(25, ...sessions.map((s) => s.title.length))

  const header = `Session ID${" ".repeat(maxIdWidth - 10)}  Title${" ".repeat(maxTitleWidth - 5)}  Updated`
  lines.push(header)
  lines.push("─".repeat(header.length))
  for (const session of sessions) {
    const truncatedTitle = Locale.truncate(session.title, maxTitleWidth)
    const timeStr = Locale.todayTimeOrDateTime(session.time.updated)
    const line = `${session.id.padEnd(maxIdWidth)}  ${truncatedTitle.padEnd(maxTitleWidth)}  ${timeStr}`
    lines.push(line)
  }

  return lines.join(EOL)
}

function formatSessionJSON(sessions: Session.Info[]): string {
  const jsonData = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    updated: session.time.updated,
    created: session.time.created,
    projectId: session.projectID,
    directory: session.directory,
  }))
  return JSON.stringify(jsonData, null, 2)
}

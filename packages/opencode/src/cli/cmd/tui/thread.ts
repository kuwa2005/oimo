import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import { Rpc } from "@/util"
import { type rpc } from "./worker"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { Log } from "@/util"
import { errorMessage } from "@/util/error"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptionsNoConfig } from "@/cli/network"
import { Filesystem } from "@/util"
import type { GlobalEvent } from "@mimo-ai/sdk/v2"
import type { EventSource } from "./context/sdk"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { writeHeapSnapshot } from "v8"
import { TuiConfig } from "./config/tui"
import { MIMOCODE_PROCESS_ROLE, MIMOCODE_RUN_ID, ensureRunID, sanitizedProcessEnv } from "@/util/mimo-process"
import { checkTrust, markTrusted } from "@/project/workspace-trust"
import { t } from "@/cli/i18n"
import { CHARACTER_CLI_HELP } from "@/character/mode"

declare global {
  const OPENCODE_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    subscribe: async (handler) => {
      return client.on<GlobalEvent>("global.event", (e) => {
        handler(e)
      })
    },
  }
}

async function target() {
  if (typeof OPENCODE_WORKER_PATH !== "undefined") return OPENCODE_WORKER_PATH
  const dist = new URL("./cli/cmd/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  return new URL("./worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

async function promptWorkspaceTrust(directory: string, level: "untrusted" | "dangerous"): Promise<boolean> {
  const prompts = await import("@clack/prompts")
  const { EOL } = await import("os")

  if (level === "dangerous") {
    const isRoot = path.parse(directory).root === directory
    const title = t(isRoot ? "trust.dangerous.title_root" : "trust.dangerous.title_home")
    const body = t(isRoot ? "trust.dangerous.body_root" : "trust.dangerous.body_home")
    const advice = t(isRoot ? "trust.dangerous.advice_root" : "trust.dangerous.advice_home")
    prompts.log.warning(
      [
        UI.Style.TEXT_WARNING_BOLD + title + UI.Style.TEXT_NORMAL,
        "",
        directory,
        "",
        body,
        "",
        UI.Style.TEXT_DANGER + t("trust.plugin_warn") + UI.Style.TEXT_NORMAL,
        "",
        advice,
      ].join(EOL),
    )
    const result = await prompts.select({
      message: "",
      options: [
        { label: t("trust.dangerous.option.no"), value: false },
        { label: t("trust.dangerous.option.yes"), value: true },
      ],
    })
    if (prompts.isCancel(result)) return false
    return result
  }

  prompts.log.info(
    [
      UI.Style.TEXT_HIGHLIGHT_BOLD + t("trust.title") + UI.Style.TEXT_NORMAL,
      "",
      directory,
      "",
      t("trust.safety_check"),
      "",
      t("trust.capabilities"),
      "",
      UI.Style.TEXT_DANGER + t("trust.plugin_warn") + UI.Style.TEXT_NORMAL,
    ].join(EOL),
  )
  const result = await prompts.select({
    message: "",
    options: [
      { label: t("trust.option.yes"), value: true },
      { label: t("trust.option.no"), value: false },
    ],
  })
  if (prompts.isCancel(result)) return false
  return result
}

/** Red risk gate shown every Super Auto (--spauto/--autosp) launch. No persistence. */
async function promptSuperAutoWarning(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    UI.error(t("spauto.warn.need_tty"))
    return false
  }

  const prompts = await import("@clack/prompts")
  const { EOL } = await import("os")
  const red = (line: string) => UI.Style.BANNER_DANGER + line + UI.Style.TEXT_NORMAL
  const redDim = (line: string) => UI.Style.BANNER_DANGER_DIM + line + UI.Style.TEXT_NORMAL
  const pad = (s: string, width: number) => {
    const len = [...s].length
    if (len >= width) return s
    return s + " ".repeat(width - len)
  }
  const banner = t("spauto.warn.banner")
  const width = Math.max(64, [...banner].length)
  const bar = " ".repeat(width)

  process.stderr.write(EOL)
  process.stderr.write(red(bar) + EOL)
  process.stderr.write(red(pad(banner, width)) + EOL)
  process.stderr.write(red(bar) + EOL)
  process.stderr.write(EOL)

  prompts.log.error(
    [
      UI.Style.TEXT_DANGER_BOLD + t("spauto.warn.title") + UI.Style.TEXT_NORMAL,
      "",
      t("spauto.warn.body"),
      "",
      UI.Style.TEXT_DANGER_BOLD + t("spauto.warn.advice") + UI.Style.TEXT_NORMAL,
    ].join(EOL),
  )

  // Safe default first: refuse.
  const result = await prompts.select({
    message: redDim(" Super Auto "),
    options: [
      { label: t("spauto.warn.option.no"), value: false },
      { label: t("spauto.warn.option.yes"), value: true },
    ],
  })
  if (prompts.isCancel(result)) return false
  return result
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "oimo TUI を起動する",
  builder: (yargs) =>
    withNetworkOptions(yargs)
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
      }),
  handler: async (args) => {
    // Keep ENABLE_PROCESSED_INPUT cleared even if other code flips it.
    // (Important when running under `bun run` wrappers on Windows.)
    const unguard = win32InstallCtrlCGuard()
    try {
      // Must be the very first thing — disables CTRL_C_EVENT before any Worker
      // spawn or async work so the OS cannot kill the process group.
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

      // Resolve relative --project paths from PWD, then use the real cwd after
      // chdir so the thread and worker share the same directory key.
      const root = Filesystem.resolve(process.env.PWD ?? process.cwd())
      const next = args.project
        ? Filesystem.resolve(path.isAbsolute(args.project) ? args.project : path.join(root, args.project))
        : Filesystem.resolve(process.cwd())
      const file = await target()
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())

      const spauto = !!args.spauto
      const fde = !!args.fde
      const se = !!args.autonomy
      const { resolveAutonomyRequest } = await import("@/autonomy/resolve")
      const autonomyReq = resolveAutonomyRequest({
        source: "cli",
        se,
        fde,
        spauto,
      })
      // --se and --fde may be combined: canonical profile=fde with both learning lenses.
      const characterRaw =
        typeof args.character === "string" ? args.character : args.character === true ? "" : undefined
      const characterMode = (await import("@/character/mode")).resolveCharacterCli(characterRaw)
      {
        const { validateCharacterArg } = await import("@/character/mode")
        const characterError = validateCharacterArg(characterRaw)
        if (characterError) {
          UI.error(characterError)
          process.exitCode = 1
          return
        }
      }
      // Super Auto: dramatic risk acknowledgment EVERY launch, before any auto-approve.
      // After accept, TUI will not stop for trust / permissions / questions.
      if (spauto) {
        const accepted = await promptSuperAutoWarning()
        if (!accepted) {
          process.exitCode = 1
          return
        }
      }

      const skipTrust = args.trust || args.auto || args["dangerously-skip-permissions"] || spauto
      if (!skipTrust) {
        const trustLevel = await checkTrust(cwd)
        if (trustLevel !== "trusted") {
          const accepted = await promptWorkspaceTrust(cwd, trustLevel)
          if (!accepted) {
            return
          }
          if (trustLevel === "untrusted") await markTrusted(cwd)
        }
      }

      if (args.auto || args["dangerously-skip-permissions"] || spauto) {
        // Propagate to the worker (which loads config) via the env it inherits
        // from sanitizedProcessEnv. Config injects an allow-all base under the
        // user's permission rules so denies still win.
        process.env.MIMOCODE_DANGEROUSLY_SKIP_PERMISSIONS = "1"
        // Forced-ask (bash_delete) is the only ask that still blocks under
        // --auto, so a `rm -rf /tmp/...` would halt the run waiting for a
        // human. Route deletes through the regular (auto-allow) ask instead:
        // --auto / Super Auto must never stop mid-run.
        process.env.MIMOCODE_AUTO_APPROVE_DELETE = "1"
      }

      if (autonomyReq.request.profile !== "off") {
        process.env.MIMOCODE_AUTONOMY = "1"
        // Safe permission auto-approve base (forced-ask still human-gated unless spauto/auto).
        // full_auto (super_auto) still sets skip-permissions; safe_auto migration continues in later PRs.
        process.env.MIMOCODE_DANGEROUSLY_SKIP_PERMISSIONS = "1"
      }

      if (autonomyReq.request.profile === "fde") {
        process.env.MIMOCODE_FDE = "1"
      }

      if (autonomyReq.request.learningLenses.includes("fde")) {
        process.env.MIMOCODE_FRICTION_FDE = "1"
      }
      if (autonomyReq.request.learningLenses.includes("se")) {
        process.env.MIMOCODE_FRICTION_SE = "1"
      }

      process.env.MIMOCODE_CHARACTER = characterMode

      if (autonomyReq.request.profile === "super_auto") {
        process.env.MIMOCODE_SPAUTO = "1"
      }

      const env = sanitizedProcessEnv({
        [MIMOCODE_PROCESS_ROLE]: "worker",
        [MIMOCODE_RUN_ID]: ensureRunID(),
      })

      const worker = new Worker(file, {
        env,
      })
      worker.onerror = (e) => {
        Log.Default.error("thread error", {
          message: e.message,
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          error: e.error,
        })
      }

      const client = Rpc.client<typeof rpc>(worker)
      const error = (e: unknown) => {
        Log.Default.error("process error", { error: errorMessage(e) })
      }
      const reload = () => {
        client.call("reload", undefined).catch((err) => {
          Log.Default.warn("worker reload failed", {
            error: errorMessage(err),
          })
        })
      }
      process.on("uncaughtException", error)
      process.on("unhandledRejection", error)
      process.on("SIGUSR2", reload)

      let stopped = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        process.off("uncaughtException", error)
        process.off("unhandledRejection", error)
        process.off("SIGUSR2", reload)
        await withTimeout(client.call("shutdown", undefined), 5000).catch((error) => {
          Log.Default.warn("worker shutdown failed", {
            error: errorMessage(error),
          })
        })
        worker.terminate()
      }

      const prompt = await input(args.prompt)
      const config = await TuiConfig.get()

      const network = resolveNetworkOptionsNoConfig(args)
      const external =
        process.argv.includes("--port") ||
        process.argv.includes("--hostname") ||
        process.argv.includes("--mdns") ||
        network.mdns ||
        network.port !== 0 ||
        network.hostname !== "127.0.0.1"

      const transport = external
        ? {
            url: (await client.call("server", network)).url,
            fetch: undefined,
            events: undefined,
          }
        : {
            url: "http://opencode.internal",
            fetch: createWorkerFetch(client),
            events: createEventSource(client),
          }

      // Bind a loopback listener even when this TUI talks to the worker in-process.
      // The transport above stays as it was on purpose: routing the TUI's own traffic
      // through TCP and JSON would be a pointless downgrade. What the socket is for is
      // everything OUTSIDE this process — the OpenAI-compatible `/v1` surface a skill or
      // subprocess borrows a model through, which cannot exist without one. Awaited
      // rather than fired off, so a consumer spawned in the first turn finds it already
      // there; the call is idempotent and generates its own credential.
      if (!external) {
        await client
          .call("server", undefined)
          .catch((error) => Log.Default.warn("failed to bind loopback listener", { error: errorMessage(error) }))
      }

      setTimeout(() => {
        client.call("checkUpgrade", { directory: cwd }).catch(() => {})
      }, 1000).unref?.()

      const autonomy = args.autonomy || fde || spauto
      try {
        await tui({
          url: transport.url,
          async onSnapshot() {
            const tui = writeHeapSnapshot("tui.heapsnapshot")
            const server = await client.call("snapshot", undefined)
            return [tui, server]
          },
          config,
          directory: cwd,
          fetch: transport.fetch,
          events: transport.events,
          args: {
            continue: args.continue,
            warm: args.warm,
            sessionID: args.session,
            agent: args.agent ?? (autonomy ? "compose" : undefined),
            model: args.model,
            prompt,
            fork: args.fork,
            neverAsk: args["never-ask"] || spauto,
            autonomy,
            fde,
            spauto,
          },
        })
      } finally {
        await stop()
      }
    } finally {
      unguard?.()
    }
  },
})
// scratch

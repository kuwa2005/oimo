import { Effect, Layer, Schema, Context, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as CrossSpawnSpawner from "@/effect/cross-spawn-spawner"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import z from "zod"
import path from "path"
import os from "os"
import { renameSync, copyFileSync, rmSync, unlinkSync, existsSync } from "fs"
import { BusEvent } from "@/bus/bus-event"
import { Flag } from "../flag/flag"
import { Log } from "../util"
import semver from "semver"
import { InstallationChannel, InstallationVersion } from "./version"

const log = Log.create({ service: "installation" })

// This fork distributes via GitHub Releases only (curl/irm). Do not detect or
// upgrade upstream `@mimo-ai/cli` — that package is unrelated to kuwa2005/oimo.
const RELEASE_REPO = process.env.GH_REPO ?? "kuwa2005/oimo"

export type Method = "curl" | "npm" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

export type ReleaseType = "patch" | "minor" | "major"

export const Event = {
  Updated: BusEvent.define(
    "installation.updated",
    z.object({
      version: z.string(),
      method: z.string().optional(),
    }),
  ),
  UpdateAvailable: BusEvent.define(
    "installation.update-available",
    z.object({
      version: z.string(),
      method: z.string().optional(),
    }),
  ),
}

export function getReleaseType(current: string, latest: string): ReleaseType {
  const currMajor = semver.major(current)
  const currMinor = semver.minor(current)
  const newMajor = semver.major(latest)
  const newMinor = semver.minor(latest)

  if (newMajor > currMajor) return "major"
  if (newMinor > currMinor) return "minor"
  return "patch"
}

export const Info = z
  .object({
    version: z.string(),
    latest: z.string(),
  })
  .meta({
    ref: "InstallationInfo",
  })
export type Info = z.infer<typeof Info>

export const USER_AGENT = `oimo/${InstallationChannel}/${InstallationVersion}/${Flag.MIMOCODE_CLIENT}`

export function isPreview() {
  return InstallationChannel !== "latest"
}

export function isLocal() {
  return InstallationChannel === "local"
}

export class UpgradeFailedError extends Schema.TaggedErrorClass<UpgradeFailedError>()("UpgradeFailedError", {
  stderr: Schema.String,
}) {}

// TODO(oimo): uncomment when corresponding channels are supported
// const GitHubRelease = Schema.Struct({ tag_name: Schema.String })
// const BrewFormula = Schema.Struct({ versions: Schema.Struct({ stable: Schema.String }) })
// const BrewInfoV2 = Schema.Struct({
//   formulae: Schema.Array(Schema.Struct({ versions: Schema.Struct({ stable: Schema.String }) })),
// })
// const ChocoPackage = Schema.Struct({
//   d: Schema.Struct({ results: Schema.Array(Schema.Struct({ Version: Schema.String })) }),
// })
// const ScoopManifest = Schema.Struct({ version: Schema.String })

export interface Interface {
  readonly info: () => Effect.Effect<Info>
  readonly method: () => Effect.Effect<Method>
  readonly latest: (method?: Method) => Effect.Effect<string>
  readonly upgrade: (method: Method, target: string) => Effect.Effect<void, UpgradeFailedError>
}

export class Service extends Context.Service<Service, Interface>()("@oimo/Installation") {}

export const layer: Layer.Layer<Service, never, HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const httpOk = HttpClient.filterStatusOk(withTransientReadRetry(http))
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const text = Effect.fnUntraced(
        function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
          const proc = ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          })
          const handle = yield* spawner.spawn(proc)
          const out = yield* Stream.mkString(Stream.decodeText(handle.stdout))
          yield* handle.exitCode
          return out
        },
        Effect.scoped,
        Effect.catch(() => Effect.succeed("")),
      )

      const run = Effect.fnUntraced(
        function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
          const proc = ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
          })
          const handle = yield* spawner.spawn(proc)
          const [stdout, stderr] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
            { concurrency: 2 },
          )
          const code = yield* handle.exitCode
          return { code, stdout, stderr }
        },
        Effect.scoped,
        Effect.catch(() => Effect.succeed({ code: ChildProcessSpawner.ExitCode(1), stdout: "", stderr: "" })),
      )

      // TODO(oimo): uncomment when oimo is published to homebrew
      // const getBrewFormula = Effect.fnUntraced(function* () {
      //   const tapFormula = yield* text(["brew", "list", "--formula", "anomalyco/tap/opencode"])
      //   if (tapFormula.includes("opencode")) return "anomalyco/tap/opencode"
      //   const coreFormula = yield* text(["brew", "list", "--formula", "opencode"])
      //   if (coreFormula.includes("opencode")) return "opencode"
      //   return "opencode"
      // })

      const upgradeCurl = Effect.fnUntraced(
        function* (target: string) {
          if (process.platform === "win32") {
            return yield* upgradeCurlWindows(target)
          }
          const response = yield* httpOk.execute(HttpClientRequest.get(process.env.MIMOCODE_INSTALL_SCRIPT_URL ?? `https://raw.githubusercontent.com/${RELEASE_REPO}/main/install`))
          const body = yield* response.text
          const bodyBytes = new TextEncoder().encode(body)
          const proc = ChildProcess.make("bash", [], {
            stdin: Stream.make(bodyBytes),
            env: { VERSION: target },
            extendEnv: true,
          })
          const handle = yield* spawner.spawn(proc)
          const [stdout, stderr] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
            { concurrency: 2 },
          )
          const code = yield* handle.exitCode
          return { code, stdout, stderr }
        },
        Effect.scoped,
        Effect.orDie,
      )

      const upgradeCurlWindows = Effect.fnUntraced(function* (target: string) {
        const pid = process.pid
        const targetExe = process.execPath
        const stageDir = path.join(os.tmpdir(), `oimo_upgrade_${pid}`)

        // Download new version to staging dir (reuses install.ps1 logic)
        const installScriptUrl = process.env.MIMOCODE_INSTALL_SCRIPT_URL ?? `https://raw.githubusercontent.com/${RELEASE_REPO}/main/install.ps1`
        const downloadResult = yield* run(
          ["powershell.exe", "-NoProfile", "-NonInteractive", "-ep", "Bypass", "-c", "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; irm $env:INSTALL_SCRIPT_URL | iex"],
          { env: { MIMOCODE_INSTALL_DIR: stageDir, VERSION: target, INSTALL_SCRIPT_URL: installScriptUrl } },
        )
        if (downloadResult.code !== 0) return downloadResult

        // Replace in-place: Windows allows renaming a running exe
        const stagedExe = path.join(stageDir, "oimo.exe")
        if (!existsSync(stagedExe))
          return { code: 1 as ChildProcessSpawner.ExitCode, stdout: "", stderr: "staged binary not found at " + stagedExe }
        const oldExe = targetExe + `.old_${pid}`
        renameSync(targetExe, oldExe)
        try {
          copyFileSync(stagedExe, targetExe)
        } catch (e) {
          renameSync(oldExe, targetExe)
          return { code: 1 as ChildProcessSpawner.ExitCode, stdout: "", stderr: "failed to copy staged binary: " + (e instanceof Error ? e.message : String(e)) }
        }
        rmSync(stageDir, { recursive: true, force: true })
        try { unlinkSync(oldExe) } catch {}

        log.info("upgraded Windows binary in-place", { target, pid, oldExe })
        return { code: 0 as ChildProcessSpawner.ExitCode, stdout: "", stderr: "" }
      })

      const methodImpl = Effect.fn("Installation.method")(function* () {
        if (process.execPath.includes(path.join(".oimo", "bin"))) return "curl" as Method
        if (process.execPath.includes(path.join(".local", "bin"))) return "curl" as Method
        // Fork: no npm/pnpm/bun package channel. Official installs are curl/irm only.
        return "unknown" as Method
      })

      const latestImpl = Effect.fn("Installation.latest")(function* (installMethod?: Method) {
        const detectedMethod = installMethod || (yield* methodImpl())

        if (detectedMethod === "curl") {
          // Resolve the latest version from GitHub, matching the source the
          // install script downloads from. Override the repo via GH_REPO.
          const url = `https://github.com/${RELEASE_REPO}/releases/latest`
          const redirect = (yield* text(["curl", "-fsSI", "-o", "/dev/null", "-w", "%{redirect_url}", url])).trim()
          const version = redirect.split("/").pop()?.replace(/^v/, "") ?? ""
          if (/^\d+\.\d+\.\d+/.test(version)) return version
          return yield* Effect.die(new Error(`failed to resolve latest version from ${url}`))
        }

        log.warn("unsupported update channel, skipping", { method: detectedMethod })
        return yield* Effect.die(new Error(`unsupported update channel: ${detectedMethod}`))
      }, Effect.orDie)

      const upgradeImpl = Effect.fn("Installation.upgrade")(function* (m: Method, target: string) {
        if (m !== "curl") {
          return yield* new UpgradeFailedError({
            stderr:
              `Unsupported install method: ${m}. This fork distributes via GitHub Releases only. ` +
              `Reinstall with: curl -fsSL https://raw.githubusercontent.com/${RELEASE_REPO}/main/install | bash`,
          })
        }
        const result = yield* upgradeCurl(target)
        if (result.code !== 0) {
          return yield* new UpgradeFailedError({ stderr: result.stderr || "" })
        }
        log.info("upgraded", {
          method: m,
          target,
          stdout: result.stdout,
          stderr: result.stderr,
        })
        yield* text([process.execPath, "--version"])
      })

      return Service.of({
        info: Effect.fn("Installation.info")(function* () {
          return {
            version: InstallationVersion,
            latest: yield* latestImpl(),
          }
        }),
        method: methodImpl,
        latest: latestImpl,
        upgrade: upgradeImpl,
      })
    }),
  )

export const defaultLayer = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
)

export * as Installation from "."

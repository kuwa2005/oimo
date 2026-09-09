import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"

const encoder = new TextEncoder()

function mockHttpClient(handler: (request: HttpClientRequest.HttpClientRequest) => Response) {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, handler(request))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

function mockSpawner(handler: (cmd: string, args: readonly string[]) => string = () => "") {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    const output = handler(std?.command ?? "", std?.args ?? [])
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output ? Stream.make(encoder.encode(output)) : Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function testLayer(
  httpHandler: (request: HttpClientRequest.HttpClientRequest) => Response,
  spawnHandler?: (cmd: string, args: readonly string[]) => string,
) {
  return Installation.layer.pipe(Layer.provide(mockHttpClient(httpHandler)), Layer.provide(mockSpawner(spawnHandler)))
}

describe("installation", () => {
  describe("method", () => {
    test("returns unknown when not installed under curl paths", async () => {
      const layer = testLayer(
        () => jsonResponse({}),
        () => "@mimo-ai/cli@1.0.0",
      )

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.method()).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("unknown")
    })
  })

  describe("latest", () => {
    test("resolves version from GitHub latest release for curl method", async () => {
      const layer = testLayer(
        () => jsonResponse({}),
        (cmd, args) => {
          if (cmd === "curl" && args.includes("https://github.com/kuwa2005/oimo/releases/latest"))
            return "https://github.com/kuwa2005/oimo/releases/tag/v0.1.1\n"
          return ""
        },
      )

      const result = await Effect.runPromise(
        Installation.Service.use((svc) => svc.latest("curl")).pipe(Effect.provide(layer)),
      )
      expect(result).toBe("0.1.1")
    })

    test("dies for unsupported channels (npm/pnpm/bun/brew/choco/scoop/unknown)", async () => {
      const layer = testLayer(() => jsonResponse({}))
      const unsupported: Installation.Method[] = ["npm", "pnpm", "bun", "brew", "choco", "scoop", "unknown"]

      for (const method of unsupported) {
        const result = Effect.runPromise(
          Installation.Service.use((svc) => svc.latest(method)).pipe(Effect.provide(layer)),
        )
        await expect(result).rejects.toThrow("unsupported update channel")
      }
    })
  })

  describe("upgrade", () => {
    test("rejects npm with fork reinstall guidance", async () => {
      const layer = testLayer(() => jsonResponse({}))

      const err = await Effect.runPromise(
        Installation.Service.use((svc) => svc.upgrade("npm", "2.0.0")).pipe(Effect.provide(layer), Effect.flip),
      )
      expect(err._tag).toBe("UpgradeFailedError")
      expect(err.stderr).toMatch(/GitHub Releases only/)
    })

    test("fails for unknown method", async () => {
      const layer = testLayer(() => jsonResponse({}))

      const result = Effect.runPromise(
        Installation.Service.use((svc) => svc.upgrade("unknown", "2.0.0")).pipe(Effect.provide(layer)),
      )
      await expect(result).rejects.toThrow()
    })
  })
})

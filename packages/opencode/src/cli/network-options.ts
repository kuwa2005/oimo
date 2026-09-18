/**
 * Light yargs network option stubs — no Config / AppRuntime value imports.
 * Full resolve-with-config lives in `../network.ts`.
 */
import type { Argv, InferredOptionTypes } from "yargs"

export const networkOptions = {
  port: {
    type: "number" as const,
    describe: "待ち受けポート",
    default: 0,
  },
  hostname: {
    type: "string" as const,
    describe: "待ち受けホスト名",
    default: "127.0.0.1",
  },
  mdns: {
    type: "boolean" as const,
    describe: "mDNS サービス ディスカバリを有効にする (ホスト名の既定が 0.0.0.0 になる)",
    default: false,
  },
  "mdns-domain": {
    type: "string" as const,
    describe: "mDNS サービスのカスタム ドメイン名 (既定: oimo.local)",
    default: "oimo.local",
  },
  cors: {
    type: "string" as const,
    array: true,
    describe: "CORS を許可する追加ドメイン",
    default: [] as string[],
  },
  "no-auth": {
    type: "boolean" as const,
    describe: "非ループバック アドレスで認証なしの起動を許可する (危険)",
    default: false,
  },
}

export type NetworkOptions = InferredOptionTypes<typeof networkOptions>

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(networkOptions)
}

/** Pure merge of CLI args with an optional already-loaded config slice. */
export function resolveNetworkOptionsNoConfig(
  args: NetworkOptions,
  config?: {
    server?: {
      mdns?: boolean
      mdnsDomain?: string
      port?: number
      hostname?: string
      cors?: string[]
    }
  },
) {
  const portExplicitlySet = process.argv.includes("--port")
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const mdnsExplicitlySet = process.argv.includes("--mdns")
  const mdnsDomainExplicitlySet = process.argv.includes("--mdns-domain")
  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const mdnsDomain = mdnsDomainExplicitlySet ? args["mdns-domain"] : (config?.server?.mdnsDomain ?? args["mdns-domain"])
  const port = portExplicitlySet ? args.port : (config?.server?.port ?? args.port)
  const hostname = hostnameExplicitlySet
    ? args.hostname
    : mdns && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)
  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...argsCors]
  const noAuth = args["no-auth"]

  return { hostname, port, mdns, mdnsDomain, cors, noAuth }
}

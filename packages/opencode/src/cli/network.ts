import { withNetworkOptions, networkOptions, resolveNetworkOptionsNoConfig, type NetworkOptions } from "./network-options"

export { withNetworkOptions, networkOptions, resolveNetworkOptionsNoConfig, type NetworkOptions }

export async function resolveNetworkOptions(args: NetworkOptions) {
  const [{ Config }, { AppRuntime }] = await Promise.all([
    import("../config"),
    import("@/effect/app-runtime"),
  ])
  const config = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.getGlobal()))
  return resolveNetworkOptionsNoConfig(args, config)
}

import path from "path"
import type { useRoute } from "@tui/context/route"
import type { useSDK } from "@tui/context/sdk"
import type { useSync } from "@tui/context/sync"
import type { useToast } from "../ui/toast"
import { isDirectoryDeniedError } from "@/server/routes/instance/access"

type SwitchInput = {
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
  toast: ReturnType<typeof useToast>
  directory: string
  route?: ReturnType<typeof useRoute>
  navigateHome?: boolean
}

export function sameDirectory(a: string | undefined, b: string | undefined) {
  if (!a || !b) return false
  return path.resolve(a) === path.resolve(b)
}

/** dispose → switchDirectory → bootstrap (mirrors dialog-worktree). */
export async function switchDirectoryWithBootstrap(input: SwitchInput) {
  const current = input.sdk.directory
  if (sameDirectory(current, input.directory)) return true

  const previous = current
  await input.sdk.client.instance.dispose().catch(() => {})
  input.sdk.switchDirectory(input.directory)
  const failure = await input.sync.bootstrap().then(
    () => undefined,
    (e) => e,
  )
  if (failure) {
    if (previous) input.sdk.switchDirectory(previous)
    await input.sync.bootstrap({ fatal: false }).catch(() => {})
    input.toast.show({
      message: isDirectoryDeniedError(failure)
        ? `Cannot switch to ${input.directory}: outside this server's working directory`
        : `Failed to switch to ${path.basename(input.directory)}`,
      variant: "error",
    })
    return false
  }
  if (input.navigateHome) input.route?.navigate({ type: "home" })
  return true
}

export function formatSessionDirectory(directory: string, worktree?: string) {
  const base = path.basename(directory)
  const root = worktree && !sameDirectory(directory, worktree) ? path.basename(worktree) : undefined
  const detail = directory.length > 48 ? `…${directory.slice(-47)}` : directory
  return root ? `${base} (${root}) · ${detail}` : `${base} · ${detail}`
}

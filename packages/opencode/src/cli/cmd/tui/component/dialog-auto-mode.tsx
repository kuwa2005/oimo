import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useLocal } from "@tui/context/local"
import { useToast } from "@tui/ui/toast"
import { useLanguage } from "@tui/context/language"
import { useRoute } from "@tui/context/route"
import * as ConfigAutonomy from "@/config/autonomy"

const MODE_ORDER: ConfigAutonomy.Mode[] = ["none", "se", "fde", "special"]

export function DialogAutoMode() {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const local = useLocal()
  const toast = useToast()
  const route = useRoute()
  const t = useLanguage().t
  const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
  // In-memory config is updated by the server on /auto; session Run is durable server-side.
  const current = ConfigAutonomy.mode(sync.data.config)

  const apply = async (next: ConfigAutonomy.Mode) => {
    if (next === current) {
      dialog.clear()
      return
    }
    if (next === "special") {
      const ok = await new Promise<boolean>((resolve) => {
        dialog.replace(
          () => (
            <DialogSelect<boolean>
              title={t("tui.dialog.auto_mode.warn.title")}
              hint={t("tui.dialog.auto_mode.warn.body")}
              current={false}
              options={[
                {
                  value: false,
                  title: t("tui.dialog.auto_mode.warn.refuse"),
                  description: t("tui.dialog.auto_mode.warn.refuse_desc"),
                  onSelect: (ctx) => {
                    resolve(false)
                    ctx.clear()
                  },
                },
                {
                  value: true,
                  title: t("tui.dialog.auto_mode.warn.confirm"),
                  description: t("tui.dialog.auto_mode.warn.confirm_desc"),
                  onSelect: (ctx) => {
                    resolve(true)
                    ctx.clear()
                  },
                },
              ]}
            />
          ),
          () => resolve(false),
        )
      })
      if (!ok) {
        dialog.replace(() => <DialogAutoMode />)
        return
      }
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
    }
    if (sdk.directory) headers["x-oimo-directory"] = encodeURIComponent(sdk.directory)
    const res = await sdk.fetch(`${sdk.url}/config/autonomy-mode`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: next,
        scope: sessionID ? "session" : "default",
        ...(sessionID ? { sessionID } : {}),
      }),
    })
    if (!res.ok) {
      toast.show({ variant: "error", message: t("tui.dialog.auto_mode.error", { status: String(res.status) }) })
      dialog.replace(() => <DialogAutoMode />)
      return
    }
    const body = (await res.json()) as {
      config?: (typeof sync.data)["config"]
      goalsPromoted?: number
      reLockRequired?: boolean
    }
    if (body.config) sync.set("config", body.config as (typeof sync.data)["config"])

    if (next === "none") {
      local.neverAsk.set(false)
      local.skipPermissions.set(false)
    }
    if (next === "se" || next === "normal" || next === "fde") {
      local.neverAsk.set(false)
      local.skipPermissions.set(false)
      local.agent.forceSwitch("compose")
    }
    if (next === "special") {
      local.neverAsk.set(true)
      local.skipPermissions.set(true)
      local.agent.forceSwitch("compose")
      if (route.data.type === "session") {
        void sdk.client.session
          .promptAsync({
            sessionID: route.data.sessionID,
            parts: [
              {
                type: "text",
                text: [
                  "Super Auto (special) is now on.",
                  "I am leaving — continue the current task non-stop.",
                  "Raise any remaining doubts yourself, answer them from context and prior answers in this session, implement, test, and finish with documentary evidence.",
                  "Do not wait for further user input.",
                ].join(" "),
              },
            ],
          })
          .catch(() => undefined)
      }
    }

    toast.show({
      variant: next === "special" ? "warning" : "info",
      message: body.reLockRequired
        ? `${t(`tui.dialog.auto_mode.toast.${next}`)} (re-lock required)`
        : t(`tui.dialog.auto_mode.toast.${next}`),
      duration: 4000,
    })
    dialog.clear()
  }

  return (
    <DialogSelect<ConfigAutonomy.Mode>
      title={t("tui.dialog.auto_mode.title")}
      hint={t("tui.dialog.auto_mode.hint")}
      current={current}
      options={MODE_ORDER.map((mode) => ({
        value: mode,
        title: t(`tui.dialog.auto_mode.option.${mode}.title`),
        description:
          mode === current
            ? t("tui.dialog.auto_mode.current")
            : t(`tui.dialog.auto_mode.option.${mode}.desc`),
        onSelect: () => {
          void apply(mode)
        },
      }))}
    />
  )
}

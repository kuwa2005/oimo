import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useProject } from "@tui/context/project"
import { For, Show, createResource, createMemo } from "solid-js"
import { loadDashboard } from "@/evolve/store"
import { listSnapshots } from "@/evolve/rollback"
import { listPendingHandoffs } from "@/evolve/handoff"

export function DialogEvolve() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const project = useProject()
  const worktree = () => project.instance.path().worktree || project.instance.path().directory
  const projectID = () => project.project()

  const [dash] = createResource(
    () => {
      const id = projectID()
      const wt = worktree()
      if (!id || !wt) return undefined
      return { projectID: id, worktree: wt }
    },
    (key) => (key ? loadDashboard(key) : undefined),
  )
  const [snaps] = createResource(projectID, (id) => (id ? listSnapshots(id) : []))
  const [handoffs] = createResource(projectID, (id) => (id ? listPendingHandoffs(id) : []))

  const rows = createMemo(() => {
    const d = dash()
    if (!d) return [] as Array<{ k: string; v: string }>
    return [
      { k: "Root", v: d.root },
      { k: "Skills", v: String(d.skillsCount) },
      { k: "Backlog open", v: String(d.backlogOpen) },
      { k: "Briefs", v: String(d.briefsOpen.length) },
      { k: "Handoffs", v: String(handoffs()?.length ?? d.pendingHandoffs) },
      { k: "Friction reports", v: String(d.frictionReports.length) },
      { k: "Reviews", v: String(d.reviews.length) },
      { k: "Snapshots", v: String(snaps()?.length ?? 0) },
    ]
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} maxHeight={28}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Self Evolution
        </text>
        <text fg={theme.textMuted} onMouseDown={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show
        when={dash()}
        fallback={<text fg={theme.textMuted}>Loading ~/.oimo/evolve…</text>}
      >
        <For each={rows()}>
          {(row) => (
            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted} width={16}>
                {row.k}
              </text>
              <text fg={theme.text}>{row.v}</text>
            </box>
          )}
        </For>
        <Show when={(handoffs() ?? []).length > 0}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Pending handoffs (external agent)
          </text>
          <For each={(handoffs() ?? []).slice(0, 6)}>
            {(h) => (
              <text fg={theme.textMuted}>
                {h.briefFile} — {h.title}
              </text>
            )}
          </For>
        </Show>
      </Show>
    </box>
  )
}

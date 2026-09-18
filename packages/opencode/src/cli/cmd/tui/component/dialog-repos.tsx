import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useProject } from "@tui/context/project"
import { useRoute } from "@tui/context/route"
import { For, Show, createResource, createMemo, createSignal } from "solid-js"
import * as RepoWorkspace from "@/repo-workspace"

export function DialogRepos() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const project = useProject()
  const route = useRoute()
  const sessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : "cli"))
  const root = () => project.instance.path().directory || project.instance.path().worktree
  const [flash, setFlash] = createSignal("")
  const [tick, setTick] = createSignal(0)

  const [bundle, { refetch }] = createResource(
    () => ({ dir: root(), tick: tick(), session: sessionID() }),
    async ({ dir, session }) => {
      if (!dir) return undefined
      const info = await RepoWorkspace.Runtime.load(dir)
      if (!info) {
        return {
          info: undefined as RepoWorkspace.Info | undefined,
          report: undefined,
          edges: 0,
          git: [] as ReturnType<typeof RepoWorkspace.Git.statusAll>,
          scope: "",
          cs: "",
          stale: "",
          status: "",
          session,
        }
      }
      const graph = await RepoWorkspace.Graph.buildGraph(info).catch(() => undefined)
      const git = RepoWorkspace.Git.statusAll(info)
      const cs = RepoWorkspace.ChangeSet.loadChangeSet(session)
      const scope = RepoWorkspace.Scope.getScope(session)
      const stale =
        cs?.approvalFingerprint && RepoWorkspace.SessionFingerprint.isApprovalStale(info, cs.approvalFingerprint)
      return {
        info,
        report: RepoWorkspace.doctor(info),
        edges: graph?.edges.length ?? 0,
        git,
        scope: scope ? [...scope].join(", ") : cs?.executionScope?.join(", ") || "(none)",
        cs: cs
          ? `${cs.id} ${cs.status} kind=${cs.kind} files=${cs.repos.reduce((n, r) => n + r.files.length, 0)}`
          : "(no Change set)",
        stale: stale ? `BLOCKED: ${stale.message}` : "approval: fresh or none",
        status: cs?.status ?? "",
        session,
      }
    },
  )

  const rows = createMemo(() => {
    const b = bundle()
    if (!b?.info) return [] as Array<{ k: string; v: string }>
    const info = b.info
    const lines: Array<{ k: string; v: string }> = [
      { k: "Name", v: info.name },
      { k: "Primary", v: info.primaryRepositoryId },
      { k: "Layout", v: info.layout ?? "siblings" },
      { k: "Config", v: info.configPath },
      { k: "Session", v: b.session },
      { k: "Doctor", v: b.report?.ok ? "OK" : "ISSUES" },
      { k: "Graph", v: `${b.edges} edges` },
      { k: "Scope", v: b.scope },
      { k: "ChangeSet", v: b.cs },
      { k: "Stale", v: b.stale },
      { k: "CLI", v: `oimo repos plan|approve|reject --session ${b.session}` },
    ]
    for (const repo of info.repositories.values()) {
      const st = b.git.find((g) => g.repositoryId === repo.id)
      const gitBit = st
        ? ` ${st.branch ?? "DETACHED"}@${(st.head ?? "").slice(0, 7)}${st.dirty ? " dirty" : ""}`
        : ""
      lines.push({
        k: repo.id,
        v: `${repo.kind}/${repo.access}${gitBit} ${repo.canonicalPath}`,
      })
    }
    for (const issue of b.report?.issues ?? []) {
      lines.push({
        k: issue.severity,
        v: `${issue.code}${issue.repositoryId ? ` (${issue.repositoryId})` : ""}: ${issue.message}`,
      })
    }
    return lines
  })

  const approve = async () => {
    const info = bundle()?.info
    if (!info) return
    try {
      const next = RepoWorkspace.Plan.approveExistingChangeSet({
        sessionID: sessionID(),
        info,
        by: "user",
      })
      setFlash(`approved ${next.id}`)
      setTick((n) => n + 1)
      refetch()
    } catch (err) {
      setFlash(err instanceof Error ? err.message : String(err))
    }
  }

  const reject = async () => {
    try {
      const next = RepoWorkspace.Plan.rejectChangeSet(sessionID())
      setFlash(`cancelled ${next.id}`)
      setTick((n) => n + 1)
      refetch()
    } catch (err) {
      setFlash(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} maxHeight={36}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Multi-repo workspace
        </text>
        <text fg={theme.textMuted} onMouseDown={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show
        when={bundle()?.info}
        fallback={<text fg={theme.textMuted}>No repos.txt / workspace.yaml / .gitmodules in this directory.</text>}
      >
        <box flexDirection="row" gap={2}>
          <text
            fg={bundle()?.status === "planned" ? theme.primary : theme.textMuted}
            onMouseDown={() => void approve()}
          >
            [approve]
          </text>
          <text fg={theme.textMuted} onMouseDown={() => void reject()}>
            [reject]
          </text>
          <text fg={theme.textMuted}>{flash()}</text>
        </box>
        <For each={rows()}>
          {(row) => (
            <box flexDirection="row" gap={2}>
              <text fg={theme.textMuted} width={12}>
                {row.k}
              </text>
              <text fg={theme.text}>{row.v}</text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

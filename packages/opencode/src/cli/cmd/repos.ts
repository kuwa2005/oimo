import { cmd } from "./cmd"
import { Instance } from "../../project/instance"
import * as RepoWorkspace from "../../repo-workspace"
import type { Argv } from "yargs"

async function withCwd<T>(fn: () => Promise<T>) {
  return Instance.provide({
    directory: process.cwd(),
    fn,
  })
}

const ReposListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "登録済み Repository を一覧表示する",
  async handler() {
    await withCwd(async () => {
      const info = await RepoWorkspace.Runtime.load(Instance.directory)
      if (!info) {
        console.log("No multi-repo workspace configured (repos.txt / workspace.yaml / .gitmodules).")
        console.log("See docs/multi-repo/README.md")
        return
      }
      console.log(`${info.name}  primary=${info.primaryRepositoryId}  layout=${info.layout ?? "siblings"}`)
      console.log(`config: ${info.configPath}`)
      for (const repo of info.repositories.values()) {
        const access = repo.access === "read-only" ? "ro" : "rw"
        console.log(`  [${repo.kind}] ${repo.id}  ${access}  ${repo.canonicalPath}${repo.role ? `  (${repo.role})` : ""}`)
      }
    })
  },
})

const ReposDoctorCommand = cmd({
  command: "doctor",
  describe: "Workspace の整合性を検査する",
  async handler() {
    await withCwd(async () => {
      const info = await RepoWorkspace.Runtime.load(Instance.directory)
      if (!info) {
        console.log("No multi-repo workspace configured.")
        return
      }
      const report = RepoWorkspace.doctor(info)
      console.log(`${report.ok ? "OK" : "ISSUES"}  ${report.name}  repos=${report.repositoryCount}`)
      for (const issue of report.issues) {
        const where = issue.repositoryId ? ` [${issue.repositoryId}]` : ""
        console.log(`  ${issue.severity}${where}: ${issue.code} — ${issue.message}`)
      }
      if (report.issues.length === 0) console.log("  (no issues)")
    })
  },
})

const ReposStatusCommand = cmd({
  command: "status",
  describe: "Repository ごとの branch / HEAD / dirty を表示する（単一 worktree にまとめない）",
  builder: (yargs: Argv) =>
    yargs.option("repository", {
      type: "string",
      alias: "r",
      describe: "単一 Repository id（省略時は全登録 repo）",
    }),
  async handler(args) {
    await withCwd(async () => {
      const info = await RepoWorkspace.Runtime.load(Instance.directory)
      if (!info) {
        console.log("No multi-repo workspace configured.")
        return
      }
      const rows = args.repository
        ? [RepoWorkspace.Git.status(info, String(args.repository))]
        : RepoWorkspace.Git.statusAll(info)
      for (const row of rows) {
        const head = row.head ? row.head.slice(0, 12) : "(no HEAD)"
        console.log(
          `${row.repositoryId}\t${row.branch ?? "DETACHED"}\t${head}\t${row.dirty ? "dirty" : "clean"}\t${row.root}`,
        )
      }
    })
  },
})

const ReposGraphCommand = cmd({
  command: "graph",
  describe: "Repository 依存グラフを検出して表示する (evidence + confidence)",
  async handler() {
    await withCwd(async () => {
      const info = await RepoWorkspace.Runtime.load(Instance.directory)
      if (!info) {
        console.log("No multi-repo workspace configured.")
        return
      }
      const graph = await RepoWorkspace.Graph.buildGraph(info)
      console.log(RepoWorkspace.Graph.formatGraph(graph))
    })
  },
})

const ReposImpactCommand = cmd({
  command: "impact",
  describe: "横断影響分析 (例: oimo repos impact --query displayName)",
  builder: (yargs: Argv) =>
    yargs
      .option("query", {
        type: "string",
        demandOption: true,
        describe: "起点となる仕様・シンボル・API・ファイル断片",
      })
      .option("seed", {
        type: "string",
        describe: "起点 Repository id (省略可)",
      }),
  async handler(args) {
    await withCwd(async () => {
      const info = await RepoWorkspace.Runtime.load(Instance.directory)
      if (!info) {
        console.log("No multi-repo workspace configured.")
        return
      }
      const report = await RepoWorkspace.Graph.analyzeImpact(info, {
        query: String(args.query),
        seedRepositoryId: args.seed ? String(args.seed) : undefined,
      })
      console.log(RepoWorkspace.Graph.formatImpact(report))
    })
  },
})

const ReposPlanCommand = cmd({
  command: "plan",
  describe: "影響分析から横断変更計画を生成する (例: oimo repos plan --query displayName --approve)",
  builder: (yargs: Argv) =>
    yargs
      .option("query", {
        type: "string",
        demandOption: true,
        describe: "起点クエリ",
      })
      .option("seed", { type: "string", describe: "起点 Repository id" })
      .option("title", { type: "string", describe: "計画タイトル" })
      .option("session", { type: "string", describe: "Change set を紐づける session id", default: "cli" })
      .option("approve", { type: "boolean", default: false, describe: "計画を承認し execution scope を設定" }),
  async handler(args) {
    await withCwd(async () => {
      const info = await RepoWorkspace.Runtime.load(Instance.directory)
      if (!info) {
        console.log("No multi-repo workspace configured.")
        return
      }
      const impact = await RepoWorkspace.Graph.analyzeImpact(info, {
        query: String(args.query),
        seedRepositoryId: args.seed ? String(args.seed) : undefined,
      })
      const plan = RepoWorkspace.Plan.planFromImpact({
        title: args.title ? String(args.title) : `Impact: ${args.query}`,
        impact,
      })
      const started = RepoWorkspace.Plan.beginChangeSet({
        sessionID: String(args.session),
        info,
        plan,
        autoApprove: Boolean(args.approve),
      })
      RepoWorkspace.ChangeSet.saveChangeSet(started.changeSet)
      if (args.approve) {
        RepoWorkspace.Scope.setScope(String(args.session), started.changeSet.executionScope)
        RepoWorkspace.DirtyBaseline.captureBaseline(
          String(args.session),
          info,
          started.changeSet.executionScope,
        )
      }
      console.log(started.logLine)
      console.log("")
      console.log(RepoWorkspace.ChangeSet.formatChangeSet(started.changeSet))
    })
  },
})

const ReposVerifyCommand = cmd({
  command: "verify",
  describe: "Repository 別検証コマンドを検出・実行する (依存順)",
  builder: (yargs: Argv) =>
    yargs
      .option("repos", {
        type: "string",
        describe: "カンマ区切り Repository id (省略時は workspace 全 git)",
      })
      .option("dry-run", {
        type: "boolean",
        default: false,
        describe: "実行せず検出結果のみ",
      }),
  async handler(args) {
    await withCwd(async () => {
      const info = await RepoWorkspace.Runtime.load(Instance.directory)
      if (!info) {
        console.log("No multi-repo workspace configured.")
        return
      }
      const graph = await RepoWorkspace.Graph.buildGraph(info)
      const ids = args.repos
        ? String(args.repos)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [...info.repositories.values()].filter((r) => r.kind === "git" || r.kind === "submodule").map((r) => r.id)
      const order = RepoWorkspace.Graph.suggestedBuildOrder(graph, ids)
      const rows = await RepoWorkspace.Verify.runVerifyOrdered({
        info,
        repositoryIds: order,
        dryRun: Boolean(args["dry-run"]),
      })
      for (const row of rows) {
        console.log(`## ${row.repositoryId}`)
        for (const c of row.verification.commands) {
          console.log(`  ${c.name}: ${c.status}${c.reason ? ` (${c.reason})` : ""}  cwd=${c.cwd}`)
        }
      }
      const agg = RepoWorkspace.Verify.aggregateVerification(rows)
      console.log("")
      console.log(agg.summary)
    })
  },
})

const ReposChangeSetCommand = cmd({
  command: "change-set",
  aliases: ["changeset", "cs"],
  describe: "永続化された Change set / execution scope を表示する（CLI・TUI 共通 DB）",
  builder: (yargs: Argv) =>
    yargs.option("session", {
      type: "string",
      default: "cli",
      describe: "session id（TUI /repos も既定 cli を参照）",
    }),
  async handler(args) {
    await withCwd(async () => {
      const session = String(args.session)
      const cs = RepoWorkspace.ChangeSet.loadChangeSet(session)
      const scope = RepoWorkspace.Scope.getScope(session)
      if (!cs) {
        console.log(`No Change set for session=${session}`)
        console.log("Create one with: oimo repos plan --query <q> --approve --session " + session)
        return
      }
      console.log(RepoWorkspace.ChangeSet.formatChangeSet(cs))
      console.log("")
      console.log(`scope(memory/db): ${scope ? [...scope].join(", ") : "(none)"}`)
      if (cs.approvalFingerprint) {
        const info = await RepoWorkspace.Runtime.load(Instance.directory)
        if (info) {
          const stale = RepoWorkspace.SessionFingerprint.isApprovalStale(info, cs.approvalFingerprint)
          console.log(stale ? `stale: ${stale.message}` : "stale: no")
        }
      }
    })
  },
})

const ReposApproveCommand = cmd({
  command: "approve",
  describe: "planned の Change set を承認する（TUI /repos と同じ session DB）",
  builder: (yargs: Argv) =>
    yargs.option("session", { type: "string", default: "cli", describe: "session id" }),
  async handler(args) {
    await withCwd(async () => {
      const info = await RepoWorkspace.Runtime.load(Instance.directory)
      if (!info) {
        console.log("No multi-repo workspace configured.")
        return
      }
      const next = RepoWorkspace.Plan.approveExistingChangeSet({
        sessionID: String(args.session),
        info,
        by: "user",
      })
      console.log(RepoWorkspace.ChangeSet.formatChangeSet(next))
    })
  },
})

const ReposRejectCommand = cmd({
  command: "reject",
  aliases: ["cancel"],
  describe: "Change set を cancelled にする",
  builder: (yargs: Argv) =>
    yargs.option("session", { type: "string", default: "cli", describe: "session id" }),
  async handler(args) {
    await withCwd(async () => {
      const next = RepoWorkspace.Plan.rejectChangeSet(String(args.session))
      console.log(RepoWorkspace.ChangeSet.formatChangeSet(next))
    })
  },
})

export const ReposCommand = cmd({
  command: "repos",
  describe:
    "マルチリポジトリ Workspace（list / doctor / status / graph / impact / plan / approve / reject / verify / change-set）",
  builder: (yargs: Argv) =>
    yargs
      .command(ReposListCommand)
      .command(ReposDoctorCommand)
      .command(ReposStatusCommand)
      .command(ReposGraphCommand)
      .command(ReposImpactCommand)
      .command(ReposPlanCommand)
      .command(ReposApproveCommand)
      .command(ReposRejectCommand)
      .command(ReposVerifyCommand)
      .command(ReposChangeSetCommand)
      .demandCommand(),
  async handler() {},
})

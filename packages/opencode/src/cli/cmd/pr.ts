import { UI } from "../ui"
import { cmd } from "./cmd"
import { AppRuntime } from "@/effect/app-runtime"
import { Git } from "@/git"
import { Instance } from "@/project/instance"
import { Log, Process } from "@/util"

export const PrCommand = cmd({
  command: "pr <number>",
  describe: "GitHub PR のブランチを取得してチェックアウトし、oimo を実行します",
  builder: (yargs) =>
    yargs
      .positional("number", {
        type: "number",
        describe: "チェックアウトする PR 番号",
        demandOption: true,
      })
      .option("repository", {
        type: "string",
        alias: "r",
        describe: "マルチリポ Workspace 内の対象 Repository id（省略時は primary / Instance.worktree）",
      }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const project = Instance.project
        if (project.vcs !== "git") {
          UI.error("Could not find git repository. Please run this command from a git repository.")
          await Log.exit(1)
        }

        let gitCwd = Instance.worktree
        if (args.repository) {
          const RepoWorkspace = await import("@/repo-workspace")
          const info = await RepoWorkspace.Runtime.load(Instance.directory)
          if (!info) {
            UI.error("No multi-repo workspace configured; omit --repository or add workspace.yaml / repos.txt")
            await Log.exit(1)
            return
          }
          try {
            gitCwd = RepoWorkspace.Git.resolveCwd(info, String(args.repository)).cwd
          } catch (err) {
            UI.error(err instanceof Error ? err.message : String(err))
            await Log.exit(1)
            return
          }
        }

        const prNumber = args.number
        const localBranchName = `pr/${prNumber}`
        UI.println(`Fetching and checking out PR #${prNumber} in ${gitCwd}...`)

        // Use gh pr checkout with custom branch name
        const result = await Process.run(
          ["gh", "pr", "checkout", `${prNumber}`, "--branch", localBranchName, "--force"],
          {
            nothrow: true,
            cwd: gitCwd,
          },
        )

        if (result.code !== 0) {
          UI.error(`Failed to checkout PR #${prNumber}. Make sure you have gh CLI installed and authenticated.`)
          await Log.exit(1)
        }

        // Fetch PR info for fork handling and session link detection
        const prInfoResult = await Process.text(
          [
            "gh",
            "pr",
            "view",
            `${prNumber}`,
            "--json",
            "headRepository,headRepositoryOwner,isCrossRepository,headRefName,body",
          ],
          { nothrow: true },
        )

        let sessionId: string | undefined

        if (prInfoResult.code === 0) {
          const prInfoText = prInfoResult.text
          if (prInfoText.trim()) {
            const prInfo = JSON.parse(prInfoText)

            // Handle fork PRs
            if (prInfo && prInfo.isCrossRepository && prInfo.headRepository && prInfo.headRepositoryOwner) {
              const forkOwner = prInfo.headRepositoryOwner.login
              const forkName = prInfo.headRepository.name
              const remoteName = forkOwner

              // Check if remote already exists
              const remotes = await AppRuntime.runPromise(
                Git.Service.use((git) => git.run(["remote"], { cwd: gitCwd })),
              ).then((x) => x.text().trim())
              if (!remotes.split("\n").includes(remoteName)) {
                await AppRuntime.runPromise(
                  Git.Service.use((git) =>
                    git.run(["remote", "add", remoteName, `https://github.com/${forkOwner}/${forkName}.git`], {
                      cwd: gitCwd,
                    }),
                  ),
                )
                UI.println(`Added fork remote: ${remoteName}`)
              }

              // Set upstream to the fork so pushes go there
              const headRefName = prInfo.headRefName
              await AppRuntime.runPromise(
                Git.Service.use((git) =>
                  git.run(["branch", `--set-upstream-to=${remoteName}/${headRefName}`, localBranchName], {
                    cwd: gitCwd,
                  }),
                ),
              )
            }

            // Check for oimo session link in PR body
            if (prInfo && prInfo.body) {
              const sessionMatch = prInfo.body.match(/https:\/\/opncd\.ai\/s\/([a-zA-Z0-9_-]+)/)
              if (sessionMatch) {
                const sessionUrl = sessionMatch[0]
                UI.println(`Found oimo session: ${sessionUrl}`)
                UI.println(`Importing session...`)

                const importResult = await Process.text(["oimo", "import", sessionUrl], {
                  nothrow: true,
                })
                if (importResult.code === 0) {
                  const importOutput = importResult.text.trim()
                  // Extract session ID from the output (format: "Imported session: <session-id>")
                  const sessionIdMatch = importOutput.match(/Imported session: ([a-zA-Z0-9_-]+)/)
                  if (sessionIdMatch) {
                    sessionId = sessionIdMatch[1]
                    UI.println(`Session imported: ${sessionId}`)
                  }
                }
              }
            }
          }
        }

        UI.println(`Successfully checked out PR #${prNumber} as branch '${localBranchName}'`)
        UI.println()
        UI.println("Starting oimo...")
        UI.println()

        const mimoArgs = sessionId ? ["-s", sessionId] : []
        const mimoProcess = Process.spawn(["oimo", ...mimoArgs], {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          cwd: process.cwd(),
        })
        const code = await mimoProcess.exited
        if (code !== 0) throw new Error(`oimo exited with code ${code}`)
      },
    })
  },
})

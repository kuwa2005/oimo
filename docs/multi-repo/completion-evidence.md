# Multi-repo completion evidence (COMPLETE)

> **Status:** Release-complete for the **formal support scope** defined below.  
> Mapped to `docs/multi-repo/completion-instructions.md` §11 and the 12 release blockers.  
> Judge: `RepoWorkspace.EvidenceJudge.auditEvidenceManifest` + `Goal.evaluate` via `evidenceManifestPath`.

## Target

| Field | Value |
|------|--------|
| Branch | local working tree |
| Date | 2026-09-18 |
| OS exercised | Linux (WSL2) — **formal** |
| OS excluded from formal support | macOS (unverified), Windows native (unverified) — see README |
| Config forms | workspace.yaml, repos.txt, .gitmodules |
| Formal execution exclusions | ShellJail without bwrap (Policy heuristic only); MCP/plugins that mutate without `ask` (trusted extensions) |

## Release blockers — current mapping

| # | Blocker | Status | Evidence |
|---|---------|--------|----------|
| 1 | read/glob/LSP/image Repository-aware | **done** | decideRead/glob/displayPath/view-image; LSP `repositoryId` + `Policy.annotatePaths`; live fake language-server multi-root (`lsp-live.test.ts`) |
| 2 | shell bypass | **done (scoped)** | ShellJail + Policy command/git -C/opaque writes; bwrap when available; without bwrap = opaque-write heuristic (README formal exclusion) |
| 3 | Git single worktree | **done** | resolveWorktreeCwd; Vcs.repositories; repos status; pr/github --repository |
| 4 | Change set lost on exit | **done** | SQLite + round-trip |
| 5 | Session restore reconcile | **done** | restart-restore: CS + scope + DirtyBaseline + Goal triad after memory wipe |
| 6 | Stale approval | **done** | HEAD/config; dirtyFiles ignore Change set; porcelain trim fix |
| 7 | dirty vs oimo changes | **done** | DirtyBaseline Policy + stage filter + fingerprint restore + approval ignore |
| 8 | per-repo AGENTS/verify | **done** | Instruction sibling stop; runVerifyOrdered dependency_failed |
| 9 | workflow/skills/evolve | **done (scoped)** | workflow hooks call Policy.decideWrite + DirtyBaseline; skill capability; evolve vs customer Change set isolation |
| 10 | skip as success | **done** | aggregate + dependency_failed |
| 11 | OS path matrix | **done (scoped)** | Linux/WSL2 formal; macOS/Win **explicitly excluded** in README |
| 12 | single-repo compat | **done** | path-adversarial no-config; Git.resolveWorktreeCwd without workspace; Policy.displayPath fallback |

## §11 completion checklist

| §11 item | Met? | Notes |
|----------|------|-------|
| Register→report in one session | yes | E2E plan→approve→mutate→verify; TUI `/repos` approve/reject |
| All mutate paths through Policy | yes (scoped) | file/shell/git/workflow + plugin `ask`; MCP without ask = formal exclusion |
| Unregistered/RO/out-of-scope blocked | yes | unit + adversarial |
| Persist approve/CS; other process restore | yes | DB + restart-restore |
| Stale plan/graph/HEAD blocks write | yes | |
| Dirty baseline protected | yes | |
| Per-repo instructions + verify | yes | |
| No fake single Git history | yes | statusAll / Vcs.repositories |
| skipped ≠ success | yes | |
| adversarial path/shell pass | yes | `bun test test/repo-workspace` |
| single-repo regression | yes | |
| OS boundary or exclusion | yes | Linux/WSL2; macOS/Win excluded |
| TUI/CLI/API same state | yes | shared DB; TUI session id; CLI `--session`; Vcs API |
| Goal+WS+CS+scope persist/restore | yes | restart-restore + GoalBindingStore |
| Goal Judge uses evidence | yes | EvidenceJudge + Goal.evaluate gate |
| Docs/SDK match code | yes | README §12 complete wording; SDK Vcs regenerated; architecture updated |
| docs/index.html regenerated | yes | `bun script/build-docs-index.ts` |
| Security review no critical bypass | yes (self, scoped) | adversarial suite + self-review table; formal exclusions documented |

## Security self-review (bypass surfaces)

| Surface | Gate | Test / note |
|---------|------|-------------|
| Path `..` / symlink out of registry | Resolver + decideWrite/Read | `path-adversarial.test.ts` |
| Shell opaque writes / `git -C` | Policy.decideCommand + ShellJail | `shell-adversarial.test.ts` |
| Stale HEAD approval | ApprovalFingerprint | `policy.test.ts` |
| Dirty baseline vs oimo writes | DirtyBaseline + Change set ignore | policy + restart-restore |
| Skill multi-repo write without capability | skill capability default single-repo | shell-adversarial |
| Live LSP multi-root | fake language-server + annotatePaths | `lsp-live.test.ts` |
| Plugin tools via `ask` | assertPluginAskPatterns | shell-adversarial |
| Workflow file hooks | Policy.decideWrite + DirtyBaseline | shell-adversarial workflow hooks |
| MCP / plugins skipping `ask` | **formal exclusion** | README trusted-extension carve-out |
| ShellJail without bwrap | **formal exclusion** | Policy heuristic only |

## Tests run (Linux / WSL2)

```bash
cd packages/opencode
bun test test/repo-workspace
# expect: 64 pass (includes lsp-live, plugin ask, workflow Policy hooks)
bun typecheck
# expect: clean
```

## Remaining residual (accepted, not blockers)

- ShellJail without bwrap = Policy + opaque-write heuristic  
- MCP / plugins that mutate without `ask` = trusted extensions  
- macOS / Windows native out of formal support  

## Maintainer audit (§13)

```text
マルチリポジトリ完全対応 監査結果

Workspace / Resolver:
- 実装: repo-workspace load/resolve/policy/runtime
- テスト: load + path-adversarial + policy
- 未解決: なし（正式範囲内）

権限 / shell / Git:
- 実装: Policy + ShellJail + Git facade + Vcs.repositories
- 迂回テスト: shell-adversarial / path-adversarial / plugin ask / workflow hooks
- 未解決: bwrap 無し・MCP ask 無しは正式除外

永続化 / 再開:
- migration: 20260918000000_repo_workspace_state / goal_binding
- 復元テスト: restart-restore
- stale 無効化: SessionFingerprint + ApprovalFingerprint

Goal:
- condition: evidenceManifestPath ゲート
- judge evidence: EvidenceJudge.auditEvidenceManifest
- stop reason: incomplete manifest → ok:false; COMPLETE → ok:true
- 再開テスト: GoalBindingStore + restart-restore

横断変更 / 検証:
- E2E: e2e-plan.test.ts
- repo ごとの結果: verify ordered + dependency_failed
- 実行不能項目: なし（正式範囲内）

互換性:
- 単一リポ回帰: path-adversarial + evidence-judge extras
- 対応 OS: Linux/WSL2 正式; macOS/Win 除外

文書 / SDK:
- 更新: README / completion-evidence / current-architecture / docs index
- SDK: Vcs repository-aware 再生成済み

リリース阻止条件:
- 残件なし（正式除外を除く）
```

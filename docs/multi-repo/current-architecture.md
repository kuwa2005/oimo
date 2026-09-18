# oimo 現状アーキテクチャ（マルチリポジトリ準備）

利用ガイド: [README.md](./README.md) · 設定キー: [config-reference.ja.md](./config-reference.ja.md)

調査日: 2026-09-03  
対象: `packages/opencode/src` を中心とした実行時  
指示書: `docs/oimo-multi-repository-implementation-instructions.md`

本ドキュメントは Phase 0 の調査結果である。推測で新しい基盤を設計する前に、既存の cwd / Git / 権限 / セッション / TUI / skills / workflows / evolve の実態を固定する。

---

## 1. 作業ディレクトリ・Git・セッションの保持

### 1.1 実行時の単一境界: Instance

| 概念 | 型 / 置き場 | 意味 |
|------|-------------|------|
| `directory` | `InstanceContext.directory` | 起動・切替時の作業ディレクトリ（実質の cwd） |
| `worktree` | `InstanceContext.worktree` | Git ルート（sandbox）。非 Git は `"/"` |
| `project` | `Project.Info` | DB 上の Project（`id`, `worktree`, `vcs`, `sandboxes[]` 等） |

- 実装: `project/instance.ts`
- 保持: `LocalContext`（AsyncLocalStorage）+ `directory` キーの Promise キャッシュ
- Effect 側: `effect/instance-state.ts` / `instance-ref.ts`（`InstanceRef`, `WorkspaceRef`）
- 境界判定: `Instance.containsPath` = `directory` 内 **または** `worktree` 内（`worktree === "/"` のときは worktree 判定をスキップし、`external_directory` を維持）

**含意:** 1 Instance ≈ 1 checkout。複数独立 Git ルートを同時に「内側」とは扱わない。

### 1.2 Project 解決

- `project/project.ts` `fromDirectory`: 上方向に `.git` を探索し `worktree` / sandbox を決定
- `project/project-id.ts`: `.git/oimo-project-id`（または `.oimo-project-id`）で安定 `ProjectID`
- 永続: `project/project.sql.ts`（`ProjectTable`）

### 1.3 Session

- `session/session.sql.ts`: `project_id`, 任意の `workspace_id`（**control-plane** 用）、`directory`（作成時スナップショット）, messages / parts / todos / permission
- 作成時の `directory` / `projectID` は現在の Instance から取得（`session/session.ts`）
- bash のカレント: `tool/session-cwd.ts`（**プロセス内メモリのみ**。DB 非永続。既定は `Instance.directory`）

### 1.4 既存の「Workspace」語（衝突注意）

| 名前 | 場所 | 意味（現行） |
|------|------|--------------|
| Control-plane Workspace | `control-plane/workspace*.ts` | 隔離ホスト（worktree 等）、`WorkspaceID`、同期・復元。実験フラグあり |
| Instance.worktree | `Instance.worktree` | 現 checkout の Git ルート |
| Git worktree 隔離 | `worktree/index.ts`, adaptors | `<data>/worktree/<projectID>/<name>` |
| Workflow workspace jail | `workflow/workspace.ts` | オーケストレータ script のファイル IO 脱獄防止。既定 root = `Instance.worktree` |
| Workspace trust | `project/workspace-trust.ts` | 起動ディレクトリ信頼リスト（`trusted-workspaces.json`） |

指示書の **Workspace = 複数 Repository の集合** は、上記のいずれとも一致しない。実装時は製品名を分離する（推奨: `RepoWorkspace` / `SystemWorkspace`、設定キー `repositories`、CLI `/repos` または `/sys`）。本計画では設定上 `workspace` を使う場合でも、コード識別子は control-plane と衝突しない名前を優先する。

---

## 2. パス制約・権限ゲート

### 2.1 読取・書込の共通境界

- 入口: `tool/external-directory.ts`
  - `assertExternalDirectoryEffect`: Instance 外 → `external_directory` 許可確認
  - 例外（信頼エスケープ）: `<data>/memory`, `~/.oimo/evolve`, `<data>/worktree`
  - `assertWriteAllowed`: external_directory → memory-path-guard → reliability Scope
- 読取ツール: `assertExternalDirectory` + `permission: "read"`
- 書込ツール: `assertWriteAllowed` + `edit` ask
- bash: パス接触コマンドに external_directory。cwd は `SessionCwd`

### 2.2 Permission エンジン

- `permission/index.ts`: ruleset、skip-all、forced-ask、親セッション転送
- セッション / プロジェクト単位のルール（`PermissionTable` 等）
- Agent 既定に `external_directory` の ask/allow パターン（`agent/agent.ts`）

**マルチリポへの影響:** 「登録済み sibling repo」は今日はすべて Instance 外 = `external_directory`。レジストリ導入後は Resolver が **登録済み read-only / read-write** を判定し、未登録への書込を拒否する単一境界にする必要がある。ツールごとの独自 path 判定を増やさないこと。

---

## 3. システムプロンプト・ツール・コンテキスト入口

| 層 | 入口 | 現行の cwd 依存 |
|----|------|-----------------|
| System prompt | `session/system.ts` | `Instance.directory` / `worktree`、（Anthropic）`git status` / branch |
| LLM 組み立て | `session/llm.ts` | agent prompt + memory（`projectID` キー） |
| ターン本体 | `session/prompt.ts` | tools に `path: { cwd: ctx.directory, root: ctx.worktree }` |
| Tool 登録 | `tool/registry.ts` | builtin + project `{tool,tools}/*`、skill/workflow describe |
| Instruction / skills XML | `skill/index.ts` | discovery は `directory → worktree` ウォーク |

**含意:** コンテキストは単一 root 前提。Workspace summary / registry / graph の段階投入は未実装。

---

## 4. TUI 表示（リポ名・ブランチ・変更）

| UI | ファイル | 表示内容 |
|----|----------|----------|
| Sidebar / Home footer | `feature-plugins/sidebar/footer.tsx`, `home/footer.tsx` | `path.directory`（`~` 短縮）+ 任意で `:` + `vcs.branch` |
| VCS 同期 | `project/vcs.ts`, sync `vcs.branch.updated` | `VcsInfo { branch, default_branch }`。`/vcs`, `/vcs/diff` |
| 変更ファイル | `sidebar/files.tsx` | セッション diff（+/-）。footer に dirty バッジは無し |
| プロジェクト名 | DB `Project.name` | TUI の主アイデンティティには未使用（パス末尾 + branch） |

マルチリポ TUI は footer 拡張（Workspace 名 / primary / repo 数 / scope）と、表示パスの `repo-id:relpath` が最小追加点。

---

## 5. セッション再開で復元されるもの

| 項目 | 復元元 | 備考 |
|------|--------|------|
| メッセージ / parts / todos / permission | SQLite + sync bootstrap | 現在の Instance `directory` 前提 |
| `SessionTable.directory` | DB | 記録されるが、再開時に cwd を自動切替しない（TUI `-c` は現 Instance のまま） |
| control-plane `workspace_id` | DB + `control-plane/workspace.ts` `sessionRestore` | 別 Workspace なら set + re-bootstrap |
| `SessionCwd` | なし | プロセス再起動で消失 |
| multi-repo registry / change set | `repo-workspace/session-fingerprint.ts` + SQLite `repo_workspace_state` | 指紋はファイル、Change set / scope は DB。`Session.get` で `Runtime.restoreSession` |

---

## 6. skills / workflows の作業パス

### skills

- `skill/index.ts` `discoverSkills(directory, worktree)`:
  - builtin / compose / グローバル skills
  - `directory → worktree` の `.oimo` 等
  - `cfg.skills.paths`（相対は `directory` 基準）
- 実行時のエージェント cwd は依然 Instance。skill はパッケージパスを見せるだけ。

### workflows

- `workflow/runtime.ts`: `workspaceRoot = input.workspace ?? Instance.worktree`
- `isolation: "worktree"` → `<data>/worktree/<projectID>/...`
- `workflow/workspace.ts`: ルート脱獄防止の jail
- 承認: `workflow_tool_approval`（`llm.ts` + `Instance.bind`）

---

## 7. evolve の自己改変範囲

- タスク文: `session/auto-evolve.ts` — skills は `<worktree>/.oimo/skills/`、ログは `~/.oimo/evolve/<projectID>/`
- ストア: `evolve/store.ts` — `evolveRoot(projectID)`
- 書込 sandbox: `memory-path-guard.ts` — dream/distill/evolve は memory + `.oimo` + evolve root
- TUI: `{ projectID, worktree }`（`dialog-evolve.tsx` 等）

**含意:** 1 ProjectID + 1 worktree。顧客 multi-repo Change set と evolve 改変を混ぜない要件は、現状の単一境界と整合しやすいが、明示的な対象 Repository 指定が必要。

---

## 8. Git・差分・テスト・承認

| 領域 | 実装 | 備考 |
|------|------|------|
| Branch / diff | `project/vcs.ts`, `Git.Service`, HTTP `/vcs` | 単一 cwd |
| Snapshot diff | `snapshot/index.ts` | プロジェクト配下 shadow git |
| セッション差分要約 | `SessionTable.summary_*` | |
| テスト実行 | 専用 API なし | agent の `bash` + reliability evidence 慣習 |
| 承認 | permission UI、autonomy / never-ask、workflow approval、workspace trust | 横断計画承認は未実装 |

Git 境界は既に「1 checkout」。疑似単一リポ化はしていない（良い前提）。

---

## 9. 設定ファイル置き場（レジストリ候補）

| 場所 | 用途例 |
|------|--------|
| `Global.Path.config`（`oimo.json(c)`） | グローバル設定 |
| `directory → worktree` の `oimo.json(c)` / `.oimo/` | プロジェクト設定（`config/paths.ts`） |
| `Global.Path.data/trusted-workspaces.json` | 信頼ディレクトリ |
| `~/.oimo/evolve/<projectID>/` | evolve ログ（home 側） |
| SQLite `project` / session | 実行時状態 |

**推奨（後続計画で確定）:** Primary repository の `.oimo/workspace.yaml`（または `oimo.json` 内 `workspace` キー）にレジストリを置き、セッションにはパス + fingerprint を保存。グローバル一覧は任意。

---

## 10. 単一 cwd 依存のホットスポット一覧

実装時に Resolver / Execution scope へ段階移行する候補（一括置換禁止）。

1. `Instance.containsPath` / `assertExternalDirectory*`
2. `session/prompt.ts` の `path: { cwd, root }`
3. `session/system.ts` の environment / git 注入
4. `tool/session-cwd.ts` + `bash.ts` cwd
5. `file/*` / `ripgrep` / grep・glob ツールの検索ルート
6. `skill/index.ts` / `workflow/resolve.ts` の walk stop = worktree
7. `project/vcs.ts` の単一 cwd
8. TUI footer / sync `vcs` 単一ブランチ
9. evolve / memory の projectID + worktree キー
10. control-plane Workspace との命名・ID 衝突

---

## 11. 再利用できる既存抽象（作り直し禁止の根拠）

- **InstanceState + ALS**: 実行コンテキストの受け渡しパターン（マルチリポでも「現在の primary Instance」は維持し、Resolver を横に足す）
- **Permission / external_directory**: 境界外アクセスの ask/deny フロー
- **AppFileSystem.contains / resolve**: symlink・正規化の土台（Resolver はこれを包む）
- **Session 永続 + sync**: Change set / registry 指紋の載せ先候補
- **VCS サービス**: Repository ごとの並列呼び出しに拡張可能
- **Workflow jail**: 「ルート単位の脱獄防止」の先行事例
- **TUI permission / plan 確認**: 横断 change plan の UI フック

---

## 12. ギャップ（指示書要件との差分）— 2026-09-18 更新

正本の完了条件: [completion-instructions.md](./completion-instructions.md)  
証跡: [completion-evidence.md](./completion-evidence.md)（正式対応範囲で **COMPLETE**）

| 要件 | 現状 |
|------|------|
| Workspace 登録・復元 | **実装済み** |
| Repository Resolver / Policy | **実装済み** |
| 横断検索（repo-id 付き） | **grep / glob / read / view-image / LSP** |
| Dependency graph | **部分拡張可**（主要検出器あり） |
| Cross-repo change plan / Change set | **実装済み** |
| Execution scope / read-only 強制 | **file + shell + workflow Policy + ShellJail** |
| Repo 別検証集約 | **実装済み**（package.json 中心 + dependency_failed） |
| skills multi-repo capability | **実装済み** |
| TUI Workspace 表示 | **実装済み**（approve/reject + session 紐付け） |
| Repository-aware Git / PR | **実装済み** |
| workflow / evolve / Goal 統合 | **実装済み**（正式除外は README） |
| クロスプラットフォーム境界テスト | **Linux/WSL2 正式**；macOS/Win 除外 |

---

## 14. 実装棚卸し（コードリンク）

| 領域 | 主なパス | 状態 |
|------|----------|------|
| Policy | `packages/opencode/src/repo-workspace/policy.ts` | 中核（annotatePaths 含む） |
| EvidenceJudge | `repo-workspace/evidence-judge.ts` | Goal.evaluate ゲート |
| Change set DB | `repo-workspace.sql.ts` + migration `20260918000000_*` | 永続化 |
| read / glob / bash / lsp | `tool/*.ts` | `repositoryId(s)` + Policy |
| Git facade | `repo-workspace/git.ts` + `project/vcs.ts` | Repository-aware |
| テスト | `test/repo-workspace/*.test.ts` | adversarial / E2E / LSP live / EvidenceJudge |

---

## 13. Threat model（概要）

| 脅威 | 現行緩和 | マルチリポで増えるリスク |
|------|----------|---------------------------|
| worktree 外書込 | external_directory ask | 登録拡張で「許可範囲が広がる」ことをユーザーに明示しないと過剰権限 |
| symlink 脱獄 | 一部 AppFileSystem / workflow jail | Resolver で実パス正規化必須。prefix 文字列比較禁止 |
| 秘密情報のコンテキスト混入 | 限定的 | 横断検索で `.env` 等を吸い上げやすい → 除外・マスク必須 |
| dirty 上書き | 明示操作依存 | 他リポの既存 dirty を oimo 変更と混同 |
| evolve 混入 | project 単位 sandbox | 顧客リポと oimo 本体の Change set 混在 |
| control-plane Workspace 誤用 | 実験的 | 同名で誤った復元・同期を誘発 |

詳細な緩和は `implementation-plan.md` Phase 1 以降の Acceptance に落とす。

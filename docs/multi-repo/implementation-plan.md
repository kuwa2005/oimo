# oimo マルチリポジトリ実装計画

> **進捗上の注意（2026-09-18）:** 本書末尾の Phase 表示は一部古く、コードには graph / impact / plan / verify の基礎実装が存在する。完全対応に必要な残作業、安全条件、受け入れテストは [completion-instructions.md](./completion-instructions.md) を正本として参照すること。

利用ガイド: [README.md](./README.md) · 設定キー: [config-reference.ja.md](./config-reference.ja.md)

根拠: `docs/oimo-multi-repository-implementation-instructions.md`  
現状: `docs/multi-repo/current-architecture.md`  
方針日: 2026-09-03

## 置き場（feature placement）

| 能力 | 層 | 理由 |
|------|----|------|
| Repository Resolver、Execution scope、書込拒否、セッション指紋、ツール引数 `repositoryId`、TUI 境界表示、設定 schema | **Core** (`packages/opencode/src/**`) | 実行時の安全不変条件・権限・セッション・TUI |
| 横断影響分析の手順、契約検出の運用ノウハウ、E2E シナリオ説明 | **Builtin skill**（後続 Phase、ポータブルなら agent-skills ミラー） | ホスト横断で有用な「使い方」はスキル側。境界そのものはコア |

大規模リファクタ禁止。既存 Instance / Permission / VCS / sync を拡張する。

---

## 後方互換

1. Workspace 未設定 = 今日と同一（単一 Instance、`repositoryId` 省略 = primary = 現 `directory`/`worktree`）
2. 既存ツール API に必須引数を足さない。任意 `repositoryId` / 明示 Workspace tool のみ
3. 横断検索・横断書込は暗黙 `all` にしない
4. control-plane `WorkspaceID` の意味・API を壊さない（製品マルチリポは別名で導入）

### 命名方針

| 製品語（指示書） | コード推奨識別子 | 設定ファイル例 |
|------------------|------------------|----------------|
| Workspace（複数 repo） | `RepoWorkspace` / `SystemWorkspace` | Primary の `.oimo/workspace.yaml` または `oimo.json` の `repoWorkspace` |
| Repository | `RegisteredRepo` | `repositories[]` |
| CLI | `/workspace` は control-plane と紛らわしい場合 `/repos` も検討。TUI 文言は「System workspace」 | |

実装 PR で最終文字列を決めるが、**SQLite / Effect Context の型名は control-plane `Workspace` と衝突させない**。

---

## 中核モデル（段階導入）

```ts
// 概念。実際の配置は packages/opencode/src/repo-workspace/ を推奨
type RepositoryId = string

type RepositoryDescriptor = {
  id: RepositoryId
  rootPath: string       // 正規化済み絶対パス
  canonicalPath: string  // realpath 後
  kind: "git" | "directory"
  role?: string
  access: "read-only" | "read-write"
  git?: { branch?: string; head?: string; remoteNames: string[]; dirty: boolean }
}

type RepoWorkspace = {
  id: string
  name: string
  configPath: string
  primaryRepositoryId: RepositoryId
  repositories: Map<RepositoryId, RepositoryDescriptor>
  dependencyGraph?: RepositoryGraph
  executionScope: Set<RepositoryId>
}
```

内部参照は可能な限り `RepositoryLocation { repositoryId, relativePath }`。OS 直前だけ絶対パスへ解決。

### Repository Resolver（単一境界）

責務: ID→root、パス→repo（最長一致）、symlink 正規化、traversal 拒否、未登録拒否。

読取・書込・検索・shell・Git は Resolver 経由。`Instance.containsPath` は「primary + 登録済み（access に応じる）」へ拡張するか、Resolver が先に判定してから既存 gate に落とす。

---

## Phase 0 — 現状調査と設計 ✅（本ドキュメント群）

**成果物**

- [x] `docs/multi-repo/current-architecture.md`
- [x] `docs/multi-repo/implementation-plan.md`（本書）

**残作業（Phase 0 締め）**

- threat model を実装チケットへ分割済みであること（本書 Threat 節）
- 単一 cwd ホットスポット一覧の合意（architecture §10）

---

## Phase 1 — Workspace Registry（横断書込なし）

**目標:** 複数ローカル Git（および明示 `kind: directory`）を登録・検証・一覧・doctor・セッション復元できる。書込は primary のみ（従来どおり）。登録 sibling への書込はまだ実装しない（または明示 deny）。

**実装単位（小さめ PR）**

1. 設定 schema + 読込（YAML/JSON、パス正規化、存在・Git ルート・重複・入れ子検証）
2. `RepoWorkspace` サービス（load / list / add / remove / doctor）+ 単体テスト
3. Resolver 骨格（逆引き・未登録拒否）。書込パスは primary のみ allow（従来）
4. セッションに `repo_workspace` 指紋（config path、primary、repo ids、開始時 HEAD/dirty）を保存・復元。移動・削除時は推測せず再解決要求
5. TUI/CLI: `/workspace` または `/repos` の list / doctor（最小表示）
6. mimocode-docs: 設定例と安全制約（未登録書込なし）

**Acceptance**

- 単一リポ（設定なし）回帰テスト緑
- 3 repo 登録・list・doctor
- nested / 非 Git（明示なし）を拒否
- セッション再開で registry 指紋復元、欠損パスはエラー

**テスト:** `fixtures/multi-repo/` 骨格作成開始。ケース 1, 12, 13 の一部。

---

## Phase 2 — 読取専用横断探索

**目標:** 登録 repo 全体の検索・読取。結果は必ず `repositoryId` + 相対パス。context budget 制御。

**実装**

1. `search` / `grep` / `glob` / `read` に任意 `repositoryIds`（明示時のみ横断）
2. 結果型に `RepositoryLocation`
3. `.gitignore` / 巨大 / バイナリ / 秘密候補の除外・マスク
4. Workspace summary（言語・manifest・テストコマンドの軽量キャッシュ）
5. TUI: 検索・読取表示を `repo-id:path`
6. System prompt に registry 要約のみ（全ファイル投入禁止）

**Acceptance:** 指示書テスト 2, 3, 15。sibling への書込は依然拒否。

---

## Phase 3 — Dependency graph と影響分析

**目標:** evidence + confidence 付きグラフ。検出と user-declared を分離。推測を事実扱いしない。

**実装**

1. 検出器: package manifest/lock、local path deps、OpenAPI/GraphQL/proto、compose/k8s/tf/CI、DB schema、events、docs/ADR
2. `RepositoryEdge` 型（指示書どおり）
3. graph cache（HEAD / 設定変更で無効化）
4. Impact report + 実行順（production / test / generated / docs / infra 分類）
5. 計画を permission / 確認 UI に載せるフック（まだ自動書込しない）

**Acceptance:** テスト 4, 11。confidence なしの確定表示なし。

---

## Phase 4 — 計画付き横断編集

**目標:** Execution scope + read-only 強制 + Change set。

**実装**

1. Execution scope をセッションに保持。scope 外・read-only はツール層で拒否
2. Cross-repository change plan 確認（既存承認に統合。auto でもログ必須）
3. edit/write/apply_patch を Resolver + access 経由に
4. Change set: `complete | partial | failed | cancelled`、repo 別ファイル一覧
5. 生成元優先（generated 直編集の禁止を prompt + 可能なら検出）
6. repo ごとの AGENTS.md / lint 設定を混同しない

**Acceptance:** テスト 5, 6, 7, 8, 10。symlink / traversal 拒否。

---

## Phase 5 — 横断検証

**目標:** repo 別 format/lint/typecheck/test/build 検出と依存順実行。未実行を成功扱いしない。

**実装**

1. コマンド検出（package.json scripts、既存 reliability 慣習）
2. `runCommand({ repositoryId, ... })` — API の `cwd` に root を渡す（`cd &&` 連結を基本にしない）
3. 結果集約（repo 単位 + Change set 全体）
4. partial failure 表示

**Acceptance:** テスト 9。最終報告フォーマット（指示書 4.6）。

---

## Phase 6 — Git・workflow·evolve·dream 統合

**実装**

1. repo 別 status/diff/commit/PR 情報（疑似単一 commit 禁止）
2. workflow step に `repositoryId` / selector
3. skill metadata capability（既定 `single-repo`）
4. dream: repo 固有知識 vs workspace 横断知識の分離、依存に evidence/confidence/時点
5. evolve: 顧客 Change set と oimo 自己改変の分離、対象 repo 明示

**Acceptance:** テスト 10–14 の残り、E2E シナリオ（displayName 追加）。

---

## テスト計画

### Fixture

```text
packages/opencode/test/fixtures/multi-repo/
  frontend/
  backend/
  shared-schema/
  infra/
  outside-workspace/
```

（配置はパッケージ慣例に合わせて調整可。リポジトリルート直下 `fixtures/` でも可。）

### 必須ケース（指示書 §11）

Phase 完了ゲートとして番号を追跡する。E2E 合格基準は shared-schema → backend → frontend、infra は確認のみ。

### 回帰

各 Phase 終了時: 既存単一リポの typecheck + 関連 unit/integration。`bun typecheck` / テストは `packages/opencode` から実行。

---

## Threat model（実装チェックリスト）

1. 未登録・親ディレクトリへの書込拒否（ツール層）
2. symlink 経由の外書き拒否（realpath）
3. read-only 強制
4. 秘密候補の graph/LLM 除外・マスク
5. destructive / push は既存承認維持
6. 一リポの許可を他へ自動拡張しない
7. repo 追加時に権限拡張を明示
8. evolve と顧客修正の Change set 分離
9. 失敗時の自動破壊的 rollback 禁止
10. dirty の stash/reset 禁止

---

## 完了条件（Goal 監査用）

指示書 §12 をそのまま監査チェックリストとする。すべてについてリポジトリ上の証拠（コード・テスト出力・文書）が揃うまで Goal を complete にしない。

---

## 直近の次アクション

1. [done] Phase 1 registry + Resolver + doctor + fingerprint + samples
2. [done] CLI `oimo repos` / TUI `/repos` + write-gate wiring + session capture
3. [partial] Phase 2: grep `repositories[]` cross-search（glob/read の repo 指定は未）
4. Phase 3: dependency graph + impact report

本計画の更新は Phase 完了時に行い、逸脱は「安全条件を落とさない」範囲でのみ許可する。

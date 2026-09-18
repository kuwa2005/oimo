# oimo マルチリポジトリ完全対応・安全化 実装指示書

作成日: 2026-09-18  
対象: oimo メンテナー、実装担当者、レビュアー  
適用範囲: `packages/opencode` の実行時、TUI、CLI、API、SDK、テスト、関連文書

## 1. この指示書の位置づけ

本書は、既存のマルチリポジトリ実装を「登録・調査できる試験機能」から、複数の独立した Git リポジトリを一つのシステムとして**安全に調査・計画・変更・検証・報告できる製品機能**へ完成させるための実装契約である。

次の文書を置き換えるものではなく、現在のコードとの差分を埋める完了指示として併用する。

- [利用ガイド](./README.md)
- [設定リファレンス](./config-reference.ja.md)
- [既存の実装指示書](../oimo-multi-repository-implementation-instructions.md)
- [現状アーキテクチャ調査](./current-architecture.md)
- [段階実装計画](./implementation-plan.md)

既存文書と本書が進捗について矛盾する場合、**コードとテストで確認した事実を優先し、同じ PR で文書を更新すること**。安全条件について矛盾する場合は、より厳しい条件を採用する。

## 2. 配置判断

この機能は次を含むため、`docs/architecture/core-vs-skills.ja.md` の基準に従い **oimo 本隊**へ実装する。

- パス境界とアクセス権限
- セッションと承認状態の永続化
- shell / Git / workflow の実行制約
- TUI と CLI
- 実行時の安全不変条件

実装先の中心は `packages/opencode/src/repo-workspace/` とし、各ツールが独自のマルチリポ判定を持たないようにする。手順を補助するスキルを追加してもよいが、安全性をスキルやプロンプトだけに依存させてはならない。

## 3. 完成時の利用者体験

利用者が「共有スキーマに項目を追加し、API と画面を追従させて」と依頼した場合、oimo は次を行う。

1. System Workspace の設定と登録リポジトリを検証する。
2. 各リポジトリの現在の HEAD、branch、dirty 状態、アクセス権限を取得する。
3. 明示的な対象リポジトリに限って横断検索する。
4. 根拠と確信度付きの依存グラフから影響範囲を作る。
5. 変更対象、確認のみ、対象外、判断不能を区別した変更計画を表示する。
6. 計画、実行スコープ、開始時状態を一つの承認対象として確定する。
7. リポジトリごとの規約を適用し、スコープ内だけを変更する。
8. 各リポジトリを依存順に検証し、可能なら統合検証を行う。
9. 変更、未実行検証、失敗、dirty 既存差分、残存リスクをリポジトリ単位で報告する。
10. セッションを再開しても、同じ Workspace と Change set を安全に復元する。状態が変わっていれば再計画を要求する。

## 4. 現在確認できる実装と、完了を阻む不足

### 4.1 実装済みとして再利用するもの

- `workspace.yaml`、`repos.txt`、`.gitmodules` の発見と読込
- Repository registry、Resolver、doctor、セッション指紋
- `repo-id:path` 形式と明示的な横断 grep
- read-only / 未登録パスに対するファイル書込ゲート
- 依存グラフ、影響分析、変更計画、Change set、検証集約の基礎型
- `oimo repos list|doctor|graph|impact|plan|verify`
- TUI `/repos` の概要表示
- sibling repository と submodule の fixture

これらは捨てて作り直さず、境界を整理して拡張する。

### 4.2 リリース阻止条件

以下が一つでも残る場合、「完全対応」「安全な横断編集」と表現してはならない。

1. `read`、`glob`、LSP、画像読取等が Repository-aware ではない。
2. shell の任意コマンドが execution scope、read-only、未登録境界を迂回できる。
3. Git 操作が暗黙の単一 `Instance.worktree` を使う。
4. Change set、承認、execution scope、検証結果がプロセス終了で失われる。
5. セッション再開時に Workspace の再照合と stale 判定が行われない。
6. 計画承認後に HEAD、dirty、設定、依存グラフが変わっても承認が有効なままである。
7. dirty な既存差分と oimo が作った差分を区別できない。
8. repo ごとの `AGENTS.md`、検証方法、生成規則を分離して適用できない。
9. workflow、skills、evolve が暗黙に primary repo だけを対象とする、または全 repo に権限を広げる。
10. 失敗・未実行・スキップを成功として集約できる。
11. Linux、macOS、Windows/WSL のパス境界をテストしていない。
12. 単一リポジトリ利用の互換性テストがない。

### 4.3 未完成項目の実装追跡表

この表を issue / PR の起点にする。完了欄は、コード、テスト、利用者向け文書の三点が揃うまで閉じない。

| 未完成項目 | 現在の主な実装箇所 | 必須の実装 | 完了証拠 |
|---|---|---|---|
| 横断 `read` | `tool/read.ts` | `repositoryId` を受け、Resolver と read Policy で絶対パスへ解決する | primary / sibling / read-only / unregistered のテスト |
| 横断 `glob` | `tool/glob.ts` | `repositoryIds` を明示指定し、結果を `repo-id:path` で返す | 複数 repo、上限、除外、同名パスのテスト |
| LSP / code navigation | `tool/lsp.ts` | repo root ごとに LSP workspace を分離し、location に Repository ID を付ける | 同名シンボルと異なる設定の fixture |
| 画像・添付読取 | `tool/view-image.ts`、`tool/read.ts` | read Policy、秘密候補、サイズ制限を Repository-aware にする | sibling 読取と未登録拒否のテスト |
| 表示パス | `edit.ts`、`write.ts`、`apply_patch.ts` 等 | `Instance.worktree` 相対ではなく `RepositoryLocation` を共通 formatter で表示する | sibling の結果が `../` 表示にならないテスト |
| shell cwd | `tool/bash.ts`、`tool/session-cwd.ts` | `repositoryId` と repo 相対 workdir を導入し、cwd の所属と scope を検査する | cwd 切替、再開、scope 外拒否のテスト |
| shell 書込境界 | `tool/bash.ts`、`tool/shell-*` | Policy と OS sandbox / allowlist を接続し、解析不能操作を安全扱いしない | adversarial shell suite |
| interactive / actor shell | `bash-interactive.ts`、`actor.ts`、tool script | 通常 shell と同じ Repository-aware 実行契約を使う | 別入口からの迂回拒否テスト |
| Git / VCS | `git/`、`project/vcs.ts`、CLI / server routes | repo を明示する facade、repo 別 status/diff/branch/commit/push | 二つの branch / HEAD / dirty を持つ fixture |
| PR 操作 | `cli/cmd/pr.ts`、`cli/cmd/github.ts` | repo ごとの remote、base、commit、承認を使用する | 異なる remote を持つ二 repo のテスト |
| Change set 永続化 | `repo-workspace/change-set.ts` | インメモリ `Map` を DB 正本へ置換し、状態遷移を transaction 化する | プロセス再起動を跨ぐ復元テスト |
| execution scope 永続化 | `repo-workspace/scope.ts` | session に保存し、承認 fingerprint と一体で復元する | CLI 承認後に TUI / 別プロセスで復元するテスト |
| session restore | `repo-workspace/session-fingerprint.ts`、`session/session.ts` | capture だけでなく再開時 reconcile、stale 判定、ブロックを配線する | path missing / HEAD changed / dirty changed のテスト |
| 変更記録 | 共通 write gate、Change set | 成功した file mutation を repo / relative path / action として自動記録する | edit / write / patch / move / delete の記録テスト |
| graph 検出範囲 | `repo-workspace/graph/` | API、schema、infra、DB、event、docs 検出器と evidence を追加する | detector ごとの fixture と false-positive テスト |
| graph cache | `repo-workspace/graph/build.ts` | HEAD、設定、manifest hash に結び付け、stale plan を拒否する | 外部変更後の承認失効テスト |
| 横断計画 UI | `cli/cmd/tui/component/dialog-repos.tsx` | impact、plan、承認、再生成、scope、Change set を表示・操作する | TUI state / event テスト |
| CLI / TUI 状態共有 | `cli/cmd/repos.ts`、TUI、永続 state | 同一 DB state と Policy を使い、プロセスローカル状態を排除する | CLI→TUI、TUI→CLI の統合テスト |
| repo 別検証 | `repo-workspace/verify.ts` | package.json 以外も拡張し、依存失敗、attempt、統合検証を表現する | mixed-language fixture、partial failure テスト |
| repo 別 instructions | instruction discovery、session context | 各 repo の指示チェーンを対象操作時だけロードする | 相反する二つの AGENTS fixture |
| workflow | `workflow/runtime.ts`、`workflow/workspace.ts` | root 一つではなく許可 repo 集合と step ごとの Repository ID を扱う | jail escape と scope delegation テスト |
| skills capability | skill metadata / registry | multi-repo capability を宣言し、不明は `single-repo` とする | capability 解決と拒否のテスト |
| 子エージェント | task / actor / fleet | 親 scope の部分集合だけを委譲し、結果を親 Change set に統合する | scope escalation 拒否テスト |
| Goal 統合 | `session/goal.ts`、Goal TUI、永続 state | Goal を Workspace / Change set に結び付け、再開後も未達条件と証拠を復元する | 再起動、budget stop、judge retry、stale plan のテスト |
| evolve / memory | evolve、memory、distill | 顧客変更と自己改変を別 scope / Change set / knowledge namespace にする | 混在拒否と復元テスト |
| API / SDK | server routes、OpenAPI、`packages/sdk/js` | Repository-aware endpoint と schema を追加し SDK を再生成する | API contract test と生成差分 |
| クロスプラットフォーム | Resolver / shell | Windows drive、UNC、junction、WSL、大小文字を扱う | OS 別 CI、未対応 OS の明示 |
| 利用文書 | 本ディレクトリの文書、README | 実装状態と制約を一致させ、プレビュー表現を守る | docs index 再生成とリンク検査 |

## 5. 絶対に守る安全不変条件

### 5.1 deny by default

- 未登録パスへの書き込みは常に拒否する。
- `read-only` リポジトリへの書き込み、生成、format、Git 更新を拒否する。
- 横断読取は明示した Repository ID に限る。`all` を暗黙に選ばない。
- execution scope 外への変更系操作を拒否する。
- Workspace 読込、Resolver、永続状態の復元に失敗した場合、単一リポ互換モードへ黙ってフォールバックしない。設定が存在する以上は fail closed とする。
- 権限判定エラーを握りつぶして処理を続行しない。

### 5.2 パス境界

- 文字列 prefix 比較を使わず、正規化と実パスを使う。
- 既存ファイルは symlink 解決後の実パスで所属を判定する。
- 新規ファイルは最も近い既存親を実パス化し、その子として作成可能かを判定する。
- `..`、symlink、junction、Windows drive、UNC、大小文字差、WSL マウントをテストする。
- 入れ子 Git は superproject と登録 submodule の関係だけを許可する。通常の sibling 登録での入れ子は拒否する。
- Repository ID と相対パスを内部の標準表現とし、絶対パスは OS アクセス直前に Resolver で作る。

### 5.3 承認の境界

承認は「複数リポへ書いてよい」という包括許可にしない。最低限、次の組を承認対象として固定する。

- Workspace fingerprint と設定ファイル
- 対象 Repository ID
- 各 Repository の開始時 HEAD、branch、dirty fingerprint
- 変更計画と graph fingerprint
- execution scope
- 許可する操作種別（file write、command、Git commit、push 等）
- 承認日時と承認元

上記のいずれかが変わった場合、変更系操作を止めて再 doctor、再 impact、再承認を要求する。自動承認モードでも同じ情報を監査ログへ残す。

### 5.4 破壊操作

- stash、reset、clean、checkout、restore、branch delete、force push、submodule update を自動実行しない。
- rollback は `git reset --hard` ではなく、Change set に記録された oimo 由来の変更だけを対象に、利用者の明示指示がある場合に限る。
- commit、push、PR は Repository ごとに独立した操作として扱う。
- superproject の gitlink 更新と submodule 内の変更を別 Change set 項目として表示する。

## 6. 必須アーキテクチャ

### 6.1 単一の RepoWorkspace 実行コンテキスト

registry、Resolver、scope、承認済み計画、Change set を一つのセッションスコープのサービスから参照させる。グローバルな可変 `Map` を正本にしない。

推奨する責務分離:

```ts
type RepoWorkspaceContext = {
  info: RepoWorkspace.Info
  fingerprint: string
  sessionID: SessionID
  scope: ReadonlySet<RepositoryID>
  changeSet?: ChangeSet
}
```

- `Runtime`: 設定の発見、読込、キャッシュ、無効化
- `Resolver`: Repository ID / path の相互解決と境界判定
- `Policy`: read / write / command / Git の許可判定
- `State`: セッション、承認、Change set、検証結果の永続化
- `Graph`: evidence 付き依存グラフと stale 判定

ツールは `Policy` の結果だけで実行し、独自に access や scope を再解釈しない。

### 6.2 Repository-aware API

既存の単一リポ API は壊さず、マルチリポ時は次の形へ統一する。

```ts
readFile({ repositoryId?, path })
glob({ repositoryIds?, pattern })
grep({ repositoryIds?, pattern })
lsp({ repositoryId?, path, operation })
writeFile({ repositoryId?, path, content })
runCommand({ repositoryId?, command, args?, workdir?, intent })
gitStatus({ repositoryId })
gitDiff({ repositoryId, base? })
```

- `repositoryId` 省略は primary を意味する。
- `repositoryIds` 省略は primary のみを意味する。
- 複数 Repository の暗黙選択は禁止する。
- 表示、ツール結果、ログ、エラーには Repository ID と相対パスを必ず含める。
- SDK 公開 API を変更した場合は `./packages/sdk/js/script/build.ts` で JavaScript SDK を再生成する。

## 7. 実装作業

### Workstream A — 基準線を直す

1. `packages/opencode/test/repo-workspace` の全テストを安定して通す。
2. 非 Git ディレクトリ拒否テストが親ディレクトリの Git 状態に影響されないよう fixture を隔離する。
3. `current-architecture.md` と `implementation-plan.md` を現在のコードに合わせる。
4. 実装済み、部分実装、未実装をコードへのリンク付きで棚卸しする。
5. feature flag が必要なら、既定 OFF の逃げ道ではなく安全な段階移行のためだけに使う。

### Workstream B — Resolver と Policy を全ツールへ配線する

次の全経路を監査し、読取または変更前に共通 Policy を通す。

- `read`、`glob`、`grep`、code search、LSP、view-image
- `edit`、`write`、`apply_patch`、multiedit、notebook-edit
- change-directory、session cwd
- shell / interactive shell / actor shell / tool script
- VCS status、diff、commit、push、PR 支援
- workflow のファイル hook と子エージェント
- MCP や plugin がローカルファイル操作を委譲する経路

読取についても未登録パスを設定どおり拒否し、`allow_unregistered_reads` を権限確認の代用にしない。許可する場合でも秘密候補の横断投入は禁止する。

### Workstream C — shell を安全にする

コマンド文字列の静的解析だけで安全を保証したとみなしてはならない。任意プログラムは解析不能な書き込みを行えるため、次を実装する。

1. `runCommand` に Repository ID と明示 `cwd` を持たせる。
2. cwd は登録リポジトリ内かつ execution scope 内に限定する。
3. read-only repo では副作用のあるコマンドを禁止する。
4. パス引数として検出できる別 repo、未登録パス、親ディレクトリへの接触を Policy で拒否する。
5. 書込可能な shell は、利用可能なプラットフォームでは OS レベルの sandbox / filesystem allowlist を使う。
6. OS レベルで封じられない環境では、解析不能な変更コマンドを「安全」と分類しない。明示承認と高リスク表示を要求する。
7. コマンド前後に repo ごとの status を取得し、予期しない repo の変更を検出したら直ちに停止する。
8. `cd ... &&` ではなくプロセス API の `cwd` を使う。
9. stdout/stderr、終了コード、timeout、実行 repo を Change set に保存する。

「一般的なコマンドを列挙してブロックした」だけでは完了条件を満たさない。

### Workstream D — Git を Repository-aware にする

1. `Git.Service` と `Vcs.Service` に Repository root を明示して呼ぶ Repository-aware facade を作る。
2. status、diff、branch、HEAD、remote、default branch を Repository ごとに返す。
3. TUI と API が primary の VCS 情報だけを全体状態として表示しないようにする。
4. commit 対象ファイルが一つの Repository に属することを検証する。
5. 複数 repo の変更を一つの commit ID や一つの成功状態に見せない。
6. push、PR、remote fetch は repo ごとに既存承認ルールを適用する。
7. dirty 開始状態を保存し、既存差分を stage、format、上書きしない。
8. submodule は recorded commit、checked-out commit、tracking branch、dirty、初期化状態を再確認する。

### Workstream E — セッションと Change set を永続化する

SQLite の既存 migration パターンに従い、最低限次を永続化する。

- session と Workspace fingerprint の関連
- config path、primary、登録 repo の canonical path
- repo ごとの開始時 HEAD、branch、dirty fingerprint
- execution scope
- Cross-repository plan と承認状態
- Change set status
- repo ごとの変更ファイル、検証、コマンド結果、エラー
- graph fingerprint と生成時刻

要件:

- 保存はセッション作成時だけでなく、計画、承認、変更、検証の各遷移で行う。
- 状態遷移を transaction で保存する。
- `planned → approved → complete|partial|failed|cancelled` の不正遷移を拒否する。
- 再開時は保存パスを盲信せず、現在の設定から再解決して fingerprint を照合する。
- repo の移動、削除、HEAD 変更、dirty 変更、設定変更時は承認を無効化し、再計画を要求する。
- インメモリキャッシュは正本ではなく、DB から再構築できること。
- 古いセッションに情報がない場合は単一リポとして安全に移行し、マルチリポ承認済みとは扱わない。

### Workstream F — 依存グラフと影響分析を完成させる

最低限、次の検出器を持つ。

- package manifest、lockfile、local path dependency
- OpenAPI、GraphQL、Protocol Buffers、生成設定
- import、パッケージ名、成果物参照
- Docker Compose、Kubernetes、Terraform、CI/CD
- DB schema、migration、ORM
- event、queue、topic、producer / consumer
- README、ADR、architecture docs
- user-declared edge

各 edge は `source`、`confidence`、時点、具体的な evidence を持つ。検出できないことを `no_impact` としない。`unknown` として残す。

キャッシュは少なくとも設定 fingerprint、repo ID、HEAD、関連 manifest の hash に結び付ける。stale なグラフから書込計画を承認できないようにする。

秘密候補、バイナリ、巨大ファイル、除外対象は evidence や LLM コンテキストへ含めない。秘密らしい値はパスだけでなく内容でもマスクする。

### Workstream G — Repository ごとの規約を分離する

各 repo について、その root までの `AGENTS.md` / override、CONTRIBUTING、生成物規則、package manager、テスト方法を個別に解決する。

- primary repo の指示を sibling へ自動継承しない。
- グローバル指示だけを共通にし、repo 固有指示は当該 repo の操作時だけ注入する。
- 矛盾する指示は変更前に利用者へ示す。
- lockfile がある repo で依存関係を勝手に更新しない。
- 検証目的でも依存インストールは自動実行せず、既存ポリシーに従う。
- 生成物は生成元と生成コマンドを特定し、生成物だけを直接編集しない。

### Workstream H — 検証を完成させる

1. repo ごとに format、lint、typecheck、test、build を検出する。
2. 検出根拠と実行コマンドを計画に含める。
3. graph の依存順に実行する。
4. `cwd` は必ず対象 repo root とする。
5. timeout、abort、signal、exit code を保持する。
6. upstream repo の失敗時に downstream を `skipped: dependency_failed` とする。
7. 最後に契約テストまたは統合テストを実行できる構成を許可する。
8. コマンドなし、dry-run、環境不足、外部サービス不足を passed にしない。
9. repo ごとの結果と Change set 全体の結果を別々に表示する。
10. 再実行時は前回結果を上書きせず履歴または attempt を保持する。

### Workstream I — TUI、CLI、API を一つの状態へ接続する

TUI `/repos` を閲覧専用ダイアログで終わらせず、少なくとも次を扱えるようにする。

- Workspace、primary、repo 数、現在 scope
- repo ごとの access、branch、HEAD、dirty、doctor issue
- dependency edge と stale 表示
- impact report
- plan の承認・拒否・再生成
- Change set の状態と repo ごとの検証結果
- stale / path missing / HEAD changed のブロッキング表示

CLI、TUI、API は同じ永続状態と Policy を使う。CLI で承認した計画が別プロセスの TUI で消える実装は禁止する。

API を追加する場合は、Repository ID を必須または明確な primary 既定として OpenAPI に反映し、SDK を再生成する。

### Workstream J — workflow、skills、子エージェント、evolve を統合する

- workflow step に `repositoryId` または明示 selector を持たせる。
- workflow jail を単一の広い親ディレクトリに広げず、許可 repo root の集合として扱う。
- 子エージェントへは親の scope 以下だけを委譲し、拡張を禁止する。
- skill metadata に `single-repo`、`multi-repo-read`、`multi-repo-write`、`workspace-read-only` 等の capability を導入する。
- capability 不明の既存 skill は安全側で `single-repo` とする。
- MCP / plugin tool のローカル IO capability が不明なら、横断書込を許可しない。
- evolve / dream / distill の自己改変と顧客 Change set を別 scope、別ログ、別承認にする。
- workspace 横断知識と repo 固有知識を分離し、evidence と取得時点を保存する。

## 8. テスト要件

### 8.1 必須ユニットテスト

- config 発見順と競合
- duplicate ID、duplicate canonical path
- 非 Git directory の明示要件
- sibling 入れ子拒否と submodule 入れ子許可
- `..` traversal、symlink、junction、大小文字、UNC
- read-only / unregistered / outside-scope の拒否
- primary 既定と横断対象の明示性
- graph evidence、confidence、stale invalidation
- plan approval の fingerprint binding
- Change set 状態遷移
- verification の all-skipped 非成功
- secrets、binary、large file の除外

### 8.2 必須統合テスト

fixture の `shared-schema → backend → frontend` と read-only `infra` を使い、次を自動化する。

1. Workspace の読込と doctor。
2. schema 変更の impact が三つの変更対象を検出する。
3. infra は確認のみで scope に入らない。
4. 未承認では sibling へ書けない。
5. 承認後は scope 内だけ変更できる。
6. read-only と未登録ディレクトリは file tool と shell の両方で変更できない。
7. 変更後に shared-schema、backend、frontend の順で検証する。
8. 一部失敗時に Change set が `partial` または `failed` になる。
9. プロセス再起動後に状態を復元できる。
10. HEAD または dirty 状態を外部変更すると承認が失効する。
11. 既存 dirty ファイルを変更・stage しない。
12. repo ごとの指示が対応 repo にだけ適用される。

### 8.3 shell adversarial test

少なくとも次の迂回をテストする。

- 相対パス、絶対パス、`..`
- symlink 経由
- shell redirect、pipe、subshell、command substitution
- `cp`、`mv`、`tee`、`sed -i`、言語ランタイムからの書込
- `git -C`、`git --work-tree`、`git --git-dir`
- script file を介した間接書込
- PowerShell の `Set-Content`、`Out-File`、`Copy-Item`
- submodule と superproject の境界

パーサーが認識できないケースを allow してはならない。OS sandbox がない経路では、少なくとも明示承認と前後差分監査を必須にする。

### 8.4 回帰と実行場所

テストはリポジトリルートではなく `packages/opencode` から実行する。

```bash
cd packages/opencode
bun test test/repo-workspace
bun typecheck
```

関連する tool、session、permission、workflow、VCS のテストも変更範囲に応じて実行する。API / SDK を変更した場合は、リポジトリルートから次を実行する。

```bash
./packages/sdk/js/script/build.ts
```

## 9. Goal 要件

### 9.1 実装作業の停止条件

マルチリポ完全対応の実装を開始するときは、`/goal` または同等の Goal API に次の停止条件を設定する。文言を短縮する場合も、判定項目を落としてはならない。

```text
マルチリポジトリ完全対応・安全化を完了する。

完了とは、docs/multi-repo/completion-instructions.md のリリース阻止条件がすべて解消され、
file・shell・Git・workflow の全変更経路が共通 Policy を通り、未登録・read-only・scope 外への
変更を迂回できず、承認・Goal・Change set・execution scope・検証結果が永続化および再開可能で、
stale な設定・HEAD・dirty・graph・plan が書込前に拒否され、repo ごとの指示・変更・検証・Git
結果が分離されていることを、ユニットテスト、統合テスト、shell adversarial test、単一リポ回帰、
対応 OS のテスト、更新済み文書と SDK 生成結果によって証明した状態をいう。

未実行、skipped、unknown、部分成功、既知の境界迂回、文書のみの完成は Goal 達成としない。
```

Goal の `phase` は要件確認中を `hearing`、実装契約が確定した後を `execute` とする。質問への回答待ちが発生した場合は `waiting_user` として止め、完了へ書き換えない。

### 9.2 Goal と Workspace の結合

Goal を単なるプロセス内テキストとして扱わない。マルチリポ作業では最低限、次を Goal state または参照可能な永続 state に結び付ける。

- session ID
- Workspace fingerprint
- 対象 Repository ID と execution scope
- Change set ID と plan ID
- Goal condition の版
- hearing / execute phase
- 開始時刻、budget、judge retry 状態
- 未達のリリース阻止条件
- 最後に確認した evidence manifest
- stop reason と最後の judge verdict

セッションまたはプロセス再開時に、Goal、Change set、scope の三つを同じ fingerprint で復元する。一つだけ復元できた状態で自動実行を再開してはならない。

### 9.3 Judge の判定規則

独立 Judge は会話上の自己申告ではなく、次の具体的証拠を要求する。

1. 各リリース阻止条件に対応するコードとテスト。
2. 必須テストコマンド、実行場所、終了コード、pass / fail / skip 数。
3. adversarial test が file、shell、Git、workflow の迂回を拒否した結果。
4. プロセス再起動を跨ぐ Goal、Change set、scope、承認の復元結果。
5. stale な config、HEAD、dirty、graph、plan の拒否結果。
6. 単一リポ回帰結果。
7. 対応を表明する各 OS の結果。未検証 OS は正式対応から除外した文書。
8. API を変更した場合の SDK 再生成結果。
9. `docs/index.html` の再生成と文書整合。
10. 既知の未解決問題がゼロであること、または正式対応範囲外として明示されていること。

次は `ok: true` の根拠にならない。

- 実装予定や設計文書だけがある。
- 一部のユニットテストだけが通る。
- dry-run、skipped、not-run を passed と数える。
- primary repo のみで成功する。
- shell / Git / workflow のいずれかが共通 Policy を迂回できる。
- 現在のプロセス内だけで scope や承認が有効である。
- 「おそらく安全」「既存 permission がある」などの推測。

### 9.4 Goal の停止理由

- `completed`: 本書の完了条件と証拠要件をすべて満たした場合だけ。
- `waiting_user`: 要件または安全上の判断に利用者の回答が必須で、独立作業を終えた場合。
- `budget_turns` / `budget_duration` / `budget_cost`: 未完了として保存し、残件と再開手順を残す。
- `judge_failed`: 完了にせず、判定失敗と最後に確認できた証拠を残す。
- `impossible`: 外部資源または対応環境が本当に利用不能で、合理的な代替を試し、正式対応範囲の縮小でも要件を満たせないことを証明した場合だけ。
- `cancelled`: 利用者の明示的な中止時だけ。未完成を完了扱いしない。

budget 到達、時間切れ、テスト環境不足、難易度の高さは `completed` または安易な `impossible` の理由にならない。

### 9.5 Evidence manifest

最終 PR では `docs/multi-repo/completion-evidence.md` を作成し、次を記録する。

| 項目 | 必須内容 |
|---|---|
| 対象 | commit、branch、対応 OS、設定形式 |
| 阻止条件 | 各項目の解消 PR / code path / test |
| テスト | コマンド、実行場所、結果、未実行理由 |
| 安全監査 | path / shell / Git / workflow の迂回テスト |
| 永続化 | migration、再起動復元、stale 無効化 |
| 互換性 | 単一リポ、既存設定、旧セッション |
| 生成物 | SDK、docs index、その他の再生成 |
| 残存リスク | なし、または正式対応範囲外の明示 |

Judge が参照できるよう、最終応答にはこの manifest のパス、主要テスト結果、未実行項目を明記する。manifest が存在するだけでは証拠にならず、記載内容をコードとテスト結果に照合する。

### 9.6 Goal 統合のテスト

- Goal を設定し、未達時に Judge が継続を要求する。
- 一部テスト成功だけでは Goal が完了しない。
- process restart 後に Goal と Change set が整合して復元される。
- Workspace fingerprint 不一致時に execute phase へ自動復帰しない。
- budget stop 後の再開で未達項目が保持される。
- `waiting_user` と `cancelled` が `completed` と区別される。
- judge retry 上限到達が成功扱いされない。
- evidence manifest と実際のテスト結果が矛盾する場合、Judge が未達と判定する。

## 10. 推奨 PR 分割

一つの巨大 PR にしない。各 PR は単一リポ互換を維持し、途中状態でも安全側に倒れること。

1. 基準線修正、現状文書、失敗テスト修正
2. Resolver / Policy の統合と path adversarial tests
3. Repository-aware read / glob / LSP / display path
4. shell sandbox と Repository-aware command API
5. Repository-aware Git / VCS
6. DB migration、Change set、承認、scope の永続化
7. graph / impact / stale invalidation の完成
8. repo ごとの指示・生成・検証
9. TUI / CLI / API / SDK 統合
10. workflow / skills / subagent / evolve 統合
11. E2E、クロスプラットフォーム、文書、リリース監査

各 PR の説明に以下を含める。

- この PR が閉じるリリース阻止条件
- 変更する安全不変条件
- 新しい許可範囲
- fail-open / fail-closed の判断
- 実行したテスト
- 残る未完成項目

## 11. 完了条件

以下をすべて満たした場合にのみ、マルチリポジトリ完全対応とする。

- [ ] 登録、探索、影響分析、計画、変更、検証、報告が一つのセッションで動く
- [ ] file、shell、Git、workflow の全変更経路が同じ Policy を通る
- [ ] 未登録、read-only、scope 外への変更を迂回できない
- [ ] 承認と Change set が永続化され、別プロセスで復元できる
- [ ] stale な計画・グラフ・HEAD では書込を開始できない
- [ ] dirty な既存差分を保護し、oimo 由来変更と区別できる
- [ ] repo ごとの指示と検証を分離できる
- [ ] 複数 repo の Git 履歴を疑似的に一つへまとめない
- [ ] skipped / not-run / unknown を成功扱いしない
- [ ] adversarial path / shell tests が通る
- [ ] 単一リポ回帰テストが通る
- [ ] Linux、macOS、Windows/WSL の境界テストが通る、または未検証環境を明示して正式対応から除外する
- [ ] TUI、CLI、API が同じ状態を表示する
- [ ] Goal が Workspace / Change set / scope とともに永続化・復元される
- [ ] Goal Judge が evidence manifest と実テスト結果を用いて停止判定する
- [ ] 利用ガイド、設定リファレンス、実装計画、SDK がコードと一致する
- [ ] `bun script/build-docs-index.ts` 実行後の `docs/index.html` が更新されている
- [ ] セキュリティレビューで重大な境界迂回がない

## 12. リリース時の表現

完了条件を満たす前は、次のように表現する。

> 複数リポジトリの登録、横断調査、影響分析をサポートしています。横断編集はプレビュー機能であり、shell / Git / セッション再開を含む完全な安全保証はまだありません。

完了条件を満たした後のみ、次の表現を使用できる。

> 登録済みリポジトリを execution scope と承認済み Change set のもとで横断的に調査・変更・検証できます。未登録、read-only、scope 外の変更は file、shell、Git、workflow の共通 Policy で拒否されます。

## 13. メンテナーへの最終報告テンプレート

```text
マルチリポジトリ完全対応 監査結果

Workspace / Resolver:
- 実装:
- テスト:
- 未解決:

権限 / shell / Git:
- 実装:
- 迂回テスト:
- 未解決:

永続化 / 再開:
- migration:
- 復元テスト:
- stale 無効化:

Goal:
- condition:
- judge evidence:
- stop reason:
- 再開テスト:

横断変更 / 検証:
- E2E 結果:
- repo ごとの結果:
- 実行不能項目:

互換性:
- 単一リポ回帰:
- 対応 OS:

文書 / SDK:
- 更新ファイル:
- 再生成結果:

リリース阻止条件:
- 残件なし / 残件一覧
```

残件がある場合、状態を「完了」にせず、該当するリリース阻止条件と再現手順を記録すること。

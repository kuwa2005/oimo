# oimo Continuous Self-Evolution 完全版 実装指示書

作成日: 2026-09-18  
対象: oimo メンテナー、実装担当者、レビュアー  
前提: [マルチリポジトリ完全対応・安全化](../multi-repo/completion-instructions.md)の完了後に着手する

## 1. 目的と正本

本書は、既存の [oimo 自己進化型AI駆動開発 指示書](../../oimo進化指示書.md) を、現在のコード、安全要件、検証要件、Goal要件へ接続する**完了実装契約**である。

既存指示書は思想と要求の原典として保持する。本書は次を追加して、実装・レビュー・リリース判定の正本とする。

- ソフト進化とハード進化の責務境界
- 現在の実装との差分
- 強制可能な安全不変条件
- マルチリポジトリとの統合
- 生成物の品質・効果評価
- 永続化、監査、rollback
- unit / integration / E2E / adversarial test
- Goal停止条件と完了証拠

進捗について文書とコードが食い違う場合は、コードとテストで事実を確認し、同じPRで文書を更新する。安全条件が食い違う場合は、より厳しい条件を採用する。

## 2. 着手ゲート

### 2.1 マルチリポジトリ完了を必須前提とする

次の成果物が揃うまで、完全版oimo進化の実装フェーズへ進まない。

- `docs/multi-repo/completion-instructions.md` の完了条件がすべて成立
- `docs/multi-repo/completion-evidence.md` が存在し、コードとテストに照合済み
- file、shell、Git、workflowが共通Policyを通る
- Workspace、Change set、execution scope、承認、Goalが再開可能
- repo固有指示とworkspace横断知識を分離可能
- staleな設定、HEAD、dirty、graph、planを拒否可能

未完成のマルチリポ境界の上に自己進化を書き足すと、誤ったrepoへの知識保存、本体briefと顧客変更の混在、shell経由のscope迂回を固定化するため禁止する。

### 2.2 基準線を固定する

着手時に以下を記録する。

- 現在のcommitとbranch
- 対応OS
- evolve / dream / distill設定
- 既存テスト結果
- 自動実行の既定値
- 保存済みmemory、skill、briefのmigration方針
- 現在確認されている安全上の不足

## 3. 用語と責務

### 3.1 ソフト進化

モデルやoimo本体の製品ソースを変更せず、外付けの知識・振る舞いを改善する。

対象:

- project / repository / workspace memory
- skill
- project-local agent
- command
- hook
- workflow
- tool extension
- TUI extension
- rule / template

主な入口:

- `dream`: 経験を、根拠付きで更新可能な記憶へ統合する
- `distill`: 反復する経験を、再利用可能な能力へ結晶化する
- `evolve`: 摩擦を分析し、適切なソフト進化成果物または改善候補へルーティングする

ソフト進化は「ファイルを作れた」だけでは完了しない。検証、試用、効果判定、採用またはrollbackまでを一つのEvolutionとして扱う。

### 3.2 ハード進化

oimo本体の共通動作に問題がある場合、別の実装エージェントが単独で着手できる、検証可能な**改造指示書**を生成する。

本書におけるハード進化の完了点は次である。

```text
観測 → 分析 → 製品問題と判定 → 指示書生成 → 検証 → 人間への引き渡し
```

ハード進化そのものは、oimo本体のソースを変更、commit、push、PR作成、mergeしない。

`evolve-review`と`evolve-apply`は指示書生成後の任意の下流工程である。特に`evolve-apply`は「ハード進化」ではなく、利用者が別途承認した**製品変更デリバリーワークフロー**として扱う。

### 3.3 Evolution

一つの改善単位。最低限、次を持つ。

```ts
type Evolution = {
  id: EvolutionID
  kind: "soft" | "hard-brief"
  status:
    | "observed"
    | "candidate"
    | "planned"
    | "generated"
    | "validating"
    | "accepted"
    | "rejected"
    | "rolled_back"
    | "inconclusive"
  projectID: ProjectID
  workspaceFingerprint?: string
  repositoryIDs: RepositoryID[]
  evidenceIDs: EvidenceID[]
  artifactIDs: ArtifactID[]
  baseline?: EvaluationSnapshot
  result?: EvaluationResult
  createdAt: number
  updatedAt: number
}
```

## 4. 配置判断

`docs/architecture/core-vs-skills.ja.md`に従い、次のように分離する。

| 能力 | 配置 |
|---|---|
| sandbox、権限、永続化、監査、TUI、API、scheduler、Goal | `packages/opencode`本隊 |
| dream / distill / evolveの手順 | ビルトインskill / agent prompt |
| project固有の生成物 | `<repo>/.oimo/` |
| workspace横断の知識 | System Workspace専用の永続領域 |
| oimo本体向けbrief | `~/.oimo/evolve/<projectID>/briefs/` |
| 他ホストでも有用な汎用手順 | `kuwa2005/agent-skills`にも同期 |

安全性をプロンプトまたはskillだけに依存させない。skillを無効にしても境界が維持されること。

## 5. 現在の基盤とリリース阻止条件

### 5.1 再利用する実装

- `/dream`、`/distill`、`/evolve`、`/self-improve`
- project memoryとセッション履歴
- `.oimo/skills`等のproject extension
- `~/.oimo/evolve/<projectID>/`のbrief、friction、backlog、review、history
- `evolve_status`のmetrics、snapshot、rollback、scenario、gate
- TUI `/evolve-status`とsidebar summary
- `evolve-review`、`evolve-apply`
- memory書込無効化との連動
- file edit系のsystem-agent write sandbox

### 5.2 完全版を名乗れない条件

一つでも残る場合は「oimo進化 完全版」と表現しない。

1. `bash`、interactive shell、tool scriptが進化sandboxを迂回できる。
2. symlink / junction経由で`.oimo`またはevolve保存領域から脱出できる。
3. evolve agentが別projectの`~/.oimo/evolve/<projectID>`へ書ける。
4. raw trajectoryから秘密、個人情報、credentialをbriefやskillへ転記できる。
5. 自動実行が明示的な同意なしにraw trajectoryを分析・永続化する。
6. 自動実行のcooldownがproject / workspace単位でない。
7. session titleだけで最終実行を判定し、別projectと干渉する。
8. baselineとafterの期間が重複している。
9. 件数を利用量・難易度で正規化せず改善判定する。
10. scenario observationが自己申告だけで、実トレースから検証されない。
11. memoryやskillにprovenance、鮮度、競合、適用scopeがない。
12. 生成skillを構文検査・参照検査・sandbox実行せず有効化する。
13. ハード進化briefの必須項目、根拠、秘密除外を機械検証しない。
14. `approved: true`だけで本体変更を実行でき、実際の利用者承認に結び付かない。
15. verify / gateがfailまたはinconclusiveでもPR工程へ進む。
16. dream / distill / evolve / review / applyのパス規約が一致しない。
17. Evolution state、承認、評価、rollback情報が再開不能。
18. マルチリポ環境でrepo固有知識とworkspace知識が混在する。
19. 顧客コードのChange setとoimo本体改善のChange setが混在する。
20. 実成果物までのE2Eテストがない。

## 6. 安全不変条件

### 6.1 書込境界

- `dream`は許可されたmemory領域だけへ書く。
- `distill`はmemoryと、承認されたproject-local `.oimo`成果物だけへ書く。
- `evolve`は上記と、自projectの`~/.oimo/evolve/<projectID>`だけへ書く。
- evolve系system agentは製品ソースへ直接書かない。
- file、shell、Git、workflow、plugin、MCPの全変更経路に同じPolicyを適用する。
- lexical pathだけでなくrealpathを検査する。新規ファイルは最も近い既存親をrealpath化する。
- snapshot領域自体もsymlink、path traversal、cross-project overwriteを拒否する。
- 権限判定に失敗した場合はfail closedとする。

### 6.2 データとプライバシー

- raw trajectory分析は目的と保存範囲を示したopt-inを既定とする。
- 手動`/dream`、`/distill`、`/evolve`は当該実行への明示的指示とみなす。
- 自動実行はdream、distill、soft evolve、hard briefを個別にON/OFFできる。
- secret、token、cookie、認証ヘッダー、秘密鍵、個人情報を抽出前にredactする。
- raw本文を成果物へコピーせず、必要最小限の要約とEvidence IDを保存する。
- retention、削除、export、全停止を設定できる。
- `memory.disable_write`時は新規分析・成果物生成・自動実行をすべて止める。
- telemetryや外部送信は別の明示同意なしに行わない。

### 6.3 承認

- ソフト進化の観測と候補生成、成果物生成、activationを別状態にする。
- project-local成果物のactivation前にsnapshotと検証を必須にする。
- ハードbrief生成までは製品ソース変更権限を付与しない。
- `evolve-apply`は利用者承認イベント、brief content hash、対象repo、scope、危険区分へ結び付ける。
- permission、auth、DB migration、公開API、remote writeは追加のdangerous approvalを要求する。
- broad permissionやautonomy modeでdangerous approvalを暗黙承認しない。

### 6.4 失敗時

- 失敗、skip、not-run、inconclusiveをacceptedとして扱わない。
- 自動で破壊的rollbackを行わない。
- ソフト成果物のrollbackはEvolutionが作った差分だけを対象にする。
- product changeはGit revertまたはPR closeの手順を提示し、人間が実行する。
- 一部成功はpartialとして記録し、隠さない。

## 7. 必須アーキテクチャ

### 7.1 Evolution Context

```ts
type EvolutionContext = {
  projectID: ProjectID
  sessionID: SessionID
  workspace?: RepoWorkspaceContext
  evolutionID: EvolutionID
  mode: "manual" | "automatic"
  allowedTracks: ReadonlySet<EvolutionTrack>
  writeRoots: ReadonlySet<CanonicalPath>
  consent: EvolutionConsent
}
```

process-globalな時刻変数やMapを正本にしない。DBから再構築可能なsession-scoped serviceを使う。

### 7.2 永続モデル

SQLiteの既存migration規約に従い、最低限次を保存する。

- Evolution本体と状態遷移
- triggerとtrigger evidence
- consentと設定snapshot
- project / workspace / repo scope
- Evidence metadataとredaction状態
- Candidateとrouting decision
- Artifact、version、content hash、保存先
- baseline、after、scenario、replay結果
- snapshot、activation、rollback
- Goal、Judge verdict、stop reason
- hard briefのreviewとhandoff状態

状態遷移はtransactionで保存し、audit eventをappend-onlyで残す。

### 7.3 Evidence層

LLMへ生DBアクセスを教える方式を正本にしない。read-onlyのEvidence APIを作る。

役割:

- project / workspace / repoで絞る
- 時間範囲を固定する
- system sessionと通常sessionを区別する
- secret / PIIをredactする
- message、tool、error、permission、test、correctionを正規化する
- Evidence IDとsource locatorを返す
- 同じ入力に決定的なfingerprintを付ける

成果物はEvidence IDを参照し、生の秘密値を保持しない。

### 7.4 Candidate Router

候補を次へ分類する。

| 分類 | 出力 |
|---|---|
| durable fact | memory |
| project固有手順 | skill / command / agent |
| project runtime extension | hook / workflow / tool / TUI extension |
| workspace横断知識 | workspace memory / skill |
| oimo共通問題 | hard evolution brief |
| 一回限り・証拠不足 | skip / needs-more-evidence |
| secret・private・危険 | reject |

分類理由、confidence、代替候補を保存する。プロンプトだけでなくschema validationを行う。

## 8. ソフト進化の完全要件

### 8.1 Dream

memory entryは最低限次を持つ。

- statement
- scope: repository / workspace / project / user
- evidence IDs
- confidence
- observedAt / verifiedAt
- freshness / expiry
- conflictsWith
- status: active / disputed / stale / archived

要件:

- 推測を事実として保存しない。
- branch、HEAD、一時パス、現在の担当者など揮発情報を恒久知識化しない。
- 新しい証拠と矛盾した場合は上書きせずdisputedにする。
- 同義entryをmergeし、出典を失わない。
- repo固有のルールを別repoへ適用しない。
- 削除はarchiveを既定とし、監査可能にする。

### 8.2 Distill

候補は原則として複数回の独立Evidence、または一度でも重大で再発可能なEvidenceを要求する。

生成前:

1. 既存skill / agent / command / workflowを検索する。
2. 新規、追記、統合、分割、非推奨、skipを判断する。
3. invocation boundaryと適用scopeを定義する。
4. 入力、出力、停止条件、失敗時動作を定義する。

生成後:

- frontmatter / schema validation
- 参照ファイルとシンボルの存在確認
- secret scan
- path scope検査
- sandbox試行
- positive / negative trigger test
- 既存skillとの競合検査
- snapshotからrollback可能であること

検証を通るまでactive registryへ載せない。

### 8.3 Project-local Evolve

tool、hook、workflow、TUI extensionはskillより危険度が高い。次を必須にする。

- capability宣言
- tool / filesystem / network / external side effectの明示
- permissionの最小化
- sandbox実行
- timeout / cancellation
- deterministic validation
- rollback
- hot reload失敗時の自動無効化

permission system自体をproject-local extensionから変更できないようにする。

### 8.4 ソフト進化の採用判定

```text
candidate
  → generate in staging
  → static validation
  → scenario / replay
  → canary activation
  → measure
  → accept | revise | reject | rollback
```

生成直後の自動activationを既定にしない。memoryだけは低リスクentryをstaged activeにできるが、confidenceとsourceを表示する。

## 9. ハード進化指示書の完全要件

### 9.1 生成条件

次のすべてを満たす場合だけ生成する。

- project固有skillでは解決できない共通問題
- 複数Evidenceまたは重大な一件
- current behaviorをコードまたはテストで確認済み
- 想定原因と確認済み原因を区別
- 改善しない選択肢も比較
- 重複brief、既存issue、既存backlogを確認

### 9.2 保存先とidentity

```text
~/.oimo/evolve/<projectID>/briefs/<YYYY-MM-DD>-<slug>.md
```

同一問題は新規ファイルを乱造せずversionを更新する。各briefに安定ID、content hash、Evidence fingerprint、statusを持たせる。

### 9.3 必須内容

既存9項目に加え、次を必須にする。

```text
Meta
1. 現状
2. 問題点
3. 具体的Evidence
4. 原因（確認済み / 仮説）
5. 改善方針と代替案
6. 実装案と配置判断
7. 期待動作
8. 受け入れ条件
9. 副作用・注意点
Security / Privacy
Migration / Compatibility
Test plan
Rollback plan
Out of scope
Why not soft evolution?
```

Metaには以下を含める。

- brief ID、version、生成時刻
- priorityとImprovement Score
- project / workspace / repository scope
- Evidence windowとEvidence IDs
- HAC signalと正規化後metric
- affected capabilities
- likely filesは候補である旨
- risk class
- status

### 9.4 validator

brief保存前に機械検査する。

- 必須section
- 空の受け入れ条件禁止
- Evidence IDの存在
- secret / PII scan
- source locatorの有効性
- soft evolutionで解決不能な理由
- testとrollbackの存在
- 危険変更の明示
- duplicate / supersedes関係

失敗したbriefを`Instruction Generated`にしない。

### 9.5 引き渡し

生成完了時に、利用者へ次を示す。

- brief path
- 問題と期待効果の要約
- evidence件数と期間
- risk class
- 未確認の仮説
- 推奨する次工程: review / external agent /保留

この時点でハード進化は完了する。本体変更権限を自動取得しない。

## 10. 下流のreview / apply境界

### 10.1 evolve-review

- 実保存先をprojectIDから解決し、`.oimo/evolve`とのパス不整合をなくす。
- safety、usefulness、feasibilityに加えprivacy、testabilityを評価する。
- reviewer出力をschema validationする。
- briefのEvidenceを独立に再確認する。
- adopt / revise / reject / insufficient-evidenceを区別する。
- review結果をbrief hashへ結び付けて永続化する。

### 10.2 evolve-apply

別機能として次を強制する。

- actual user approval event
- approved brief hash / version
- target oimo repository
- execution scope
- dangerous approval
- isolated worktree
- relevant AGENTS.md
- `bun typecheck`とtargeted tests
- gate pass
- draft PRのみ

verifyまたはgateが`fail`、`skipped`、`not_run`、`inconclusive`ならPR工程へ進まない。workflowの最終`ok`は実フェーズ結果から決定する。

## 11. 観測・指標・効果評価

### 11.1 観測イベント

- task start / finish / cancel
- tool call / retry / error
- read replay
- edit churn
- build / test result
- permission ask
- user clarification / correction
- rollback
- skill search / hit / miss / outcome
- context compaction / rediscovery
- Goal verdict / re-entry

文字列キーワードだけで訂正を判定せず、会話構造、直前のagent action、明示feedbackを組み合わせる。

### 11.2 HAC

Human Attention Costは少なくとも次を分離する。

- clarification count
- avoidable clarification count
- correction count
- manual operation request
- approval count
- wait time attributable to agent
- repeated explanation

重みはversion管理し、総合scoreだけでなく構成要素を表示する。HACを下げるために必要な安全確認を省略するmetric gamingを検出する。

### 11.3 before / after

- 期間を重複させない。
- session、task、user turnあたりのrateへ正規化する。
- task categoryと難易度を可能な範囲で揃える。
- sample sizeとconfidenceを表示する。
- usage減少を改善と誤認しない。
- regression metricをguardrailにする。

### 11.4 Scenario / Replay

- observationを実トレースから自動生成する。
- fixtureと実行モデル、設定、commit、toolsetを保存する。
- self-reported JSONだけを採用根拠にしない。
- replayは秘密を除去し、外部副作用をstubまたはsandbox化する。
- 同一入力でbaselineとcandidateを比較する。
- scenario failは総合gateをfailにする。

## 12. Triggerとscheduler

- projectIDまたはworkspace ID単位でlast runを保存する。
- session titleだけで判定しない。
- process-global timestampを使わない。
- DB lock / leaseで重複起動を防ぐ。
- crash後にleaseを回収できる。
- trigger reasonとEvidenceを保存する。
- manual、interval、conditionを区別する。
- 若いproject、Evidence不足、memory write offではskip理由を保存する。
- auto-runはsilentに成果物をactive化しない。

推奨既定:

| Track | 既定 |
|---|---|
| manual dream / distill / evolve | 利用可能 |
| auto dream | opt-in |
| auto distill | opt-in |
| auto soft evolution generation | opt-in |
| auto hard brief generation | opt-in |
| product apply | 常に明示承認 |

既存opt-out設定から移行する場合は、リリースノートとmigration UIを用意する。

## 13. マルチリポジトリ統合

### 13.1 知識scope

| 知識 | 保存先・scope |
|---|---|
| repo固有 | 当該repo memory / `.oimo` |
| workspace横断 | System Workspace memory |
| user個人 | user scope |
| oimo製品共通 | hard brief候補 |

repo ID、Workspace fingerprint、Evidence sourceを必須にする。primary repoの知識をsiblingへ暗黙適用しない。

### 13.2 ソフト進化

- 書込先repoを計画に明示する。
- read-only repoには成果物を書かない。
- execution scope外へ書かない。
- 複数repoに生成する場合はCross-repository planとChange setを使う。
- repoごとのAGENTS.mdとskill規約を適用する。
- rollbackもrepoごとに追跡する。

### 13.3 ハード進化

- 顧客workspaceの問題とoimo製品問題を分離する。
- briefはEvidenceのrepoを参照してよいが、顧客コードや秘密を埋め込まない。
- oimo本体repoを対象にしたproduct Change setは、顧客Change setと別にする。
- multi-repo機能自体の改善briefは、multi-repo completion evidenceを前提にする。

## 14. TUI / CLI / API

### 14.1 Dashboard

単なる件数ではなく次を表示する。

- consent / auto-run状態
- 最終実行、次回予定、skip理由
- active / staged / disputed memory
- candidate、accepted、rejected、rolled back
- soft / hardの分類
- Evidence件数、freshness、confidence
- before / afterとsample size
- pending human action
- failed validationと安全警告
- repo / workspace scope

### 14.2 操作

- candidate詳細
- Evidenceのredacted preview
- diff
- validate
- accept / reject / rollback
- auto-run pause
- export / delete
- hard brief handoff

CLI、TUI、APIは同じ永続StateとPolicyを使う。APIを変更した場合は`./packages/sdk/js/script/build.ts`でSDKを再生成する。

## 15. 設定契約

設定例:

```jsonc
{
  "evolution": {
    "enabled": true,
    "consent_version": 1,
    "retention_days": 90,
    "dream": { "auto": false, "interval_days": 7 },
    "distill": { "auto": false, "interval_days": 30 },
    "soft": {
      "auto_generate": false,
      "auto_activate": false
    },
    "hard": {
      "auto_generate_briefs": false,
      "allow_product_apply": false
    },
    "privacy": {
      "redact_secrets": true,
      "include_raw_user_text": false
    }
  }
}
```

既存`dream`、`distill`、`evolve`キーを壊さず読み込み、deprecation warningとmigrationを提供する。設定schema、README、TUIを同時更新する。

## 16. テスト要件

### 16.1 Unit

- state transition
- consent / config migration
- per-project schedulerとlease
- Evidence redaction
- Candidate routing
- memory provenance / conflict / expiry
- artifact validator
- brief validator
- non-overlapping metrics
- normalized HAC
- scenario observation extraction
- content hash / dedup
- project-specific write roots
- realpath / symlink / junction

### 16.2 Integration

- manual dreamがprovenance付きmemoryを作る
- manual distillがskillをstaging生成し、検証後にactivateする
- invalid skillをactivateしない
- soft evolutionをsnapshotからrollbackする
- evolveがproject問題をsoftへrouteする
- evolveがproduct問題をhard briefへrouteする
- 9項目+追加sectionを満たすbriefを生成する
- secretを含むtrajectoryからsecretなしのbriefを生成する
- restart後にEvolutionとGoalを復元する
- auto-runが別projectと干渉しない
- memory write offで全自動生成を止める
- multi-repoでrepo / workspace knowledgeを分離する

### 16.3 Adversarial

- bash、runtime、script経由のsource write
- `.oimo`内symlinkからsource / external pathへの脱出
- 別projectのevolve rootへの書込
- prompt injectionを含むtrajectory
- briefへのcredential転記
- fake approval / stale approval
- tampered brief after review
- self-reported scenarioの改ざん
- metric gamingによる確認省略
- rollback対象外ファイルの削除

### 16.4 E2E合格シナリオ

#### ソフト進化

1. 同じproject固有手順が複数sessionで繰り返される。
2. Evidence APIがredact済みEvidenceを作る。
3. distillが既存assetを確認し、skill候補をstaging生成する。
4. validatorとtrigger testを通す。
5. canary利用でツール数とHACが非重複baselineより改善する。
6. skillをacceptする。
7. restart後もprovenance、version、評価を復元できる。
8. regressionを注入するとrollbackできる。

#### ハード進化

1. 複数projectで共通するoimo本体問題を検出する。
2. project skillでは解決できない理由を記録する。
3. secretなし、Evidence ID付き、必須section完備のbriefを生成する。
4. validatorが通る。
5. TUIにpending human handoffとして表示する。
6. 本体ソースが変更されていないことを確認する。
7. external agentへ渡せる自己完結性をreviewする。

#### 下流apply

1. user approvalなしでは拒否する。
2. brief改ざん後は承認を無効化する。
3. 隔離worktreeで実装する。
4. verify / gate失敗時はPRを作らない。
5. pass時だけdraft PRを作り、mergeしない。

## 17. Goal要件

### 17.1 標準停止条件

実装開始時に次を`/goal`へ設定する。

```text
マルチリポジトリ完全対応を前提として、docs/evolve/completion-instructions.mdの
ソフト進化、ハード進化指示書生成、安全、プライバシー、永続化、評価、Goal、
unit/integration/E2E/adversarial testの要件をすべて実装する。

file・shell・Git・workflowから境界を迂回できず、raw trajectoryの秘密が成果物へ漏れず、
project / workspace / repository scopeが分離され、ソフト進化が生成→検証→評価→採用/rollbackを閉じ、
ハード進化が検証済みの自己完結briefを生成して本体を変更せず人間へ引き渡し、全状態が再開可能で、
実テストとcompletion evidenceが揃った場合だけ達成とする。

文書だけ、部分成功、未実行、skipped、inconclusive、既知の迂回、品質未検証は達成としない。
```

### 17.2 Judge証拠

- multi-repo completion evidence
- 全リリース阻止条件のcode / test mapping
- soft / hard E2E結果
- shell / symlink / cross-project adversarial結果
- privacy / redaction結果
- non-overlapping before / after評価
- restart / migration / rollback結果
- 単一repoとmulti-repo回帰
- 対応OS結果
- SDKとdocs index再生成
- 既知残件ゼロ、または正式対応外の明示

budget、judge failure、環境不足はcompletedにしない。`waiting_user`、`cancelled`、`impossible`を区別し、残件と再開手順を永続化する。

## 18. 推奨PR順序

1. multi-repo完了監査とevolve基準線
2. Evolution DB state、audit、migration
3. project-specific realpath Policyとshell sandbox
4. Evidence API、redaction、retention、consent
5. scheduler / triggerのproject分離
6. provenance付きDream
7. staging / validator / activation付きDistill
8. project-local Evolveとrollback
9. metrics / HAC / scenario / replay再設計
10. hard brief schema、validator、dedup、handoff
11. review / apply承認とgate強制
12. multi-repo knowledge / Change set統合
13. TUI / CLI / API / SDK
14. E2E / adversarial / cross-platform
15. documentation / completion evidence / release audit

各PRは次を記載する。

- 閉じるリリース阻止条件
- 変更する権限範囲
- privacy impact
- migration
- fail-open / fail-closed
- テスト結果
- 残件

## 19. 完了条件

- [x] multi-repo完全対応が完了している
- [x] ソフト進化とハード進化の境界がコード、UI、文書で一致する
- [x] soft evolutionは生成→検証→評価→採用/rollbackが閉じている
- [x] hard evolutionは検証済みbriefを生成し、本体を直接変更しない
- [x] file、shell、Git、workflowで進化sandboxを迂回できない
- [x] project間、repo間、workspace間で書込と知識が混在しない
- [x] raw trajectoryのsecret / PIIが成果物へ漏れない
- [x] consent、retention、delete、pauseが機能する
- [x] trigger / cooldown / leaseがproject単位で永続化される
- [x] memoryはprovenance、confidence、freshness、conflictを持つ
- [x] skill等はstagingとvalidatorを通ってからactivateされる
- [x] briefはschema、Evidence、security、test、rollbackを満たす
- [x] before / afterは非重複・正規化・sample size付きである
- [x] scenario / replayが実トレースで検証される
- [x] fail / skip / inconclusiveで採用またはPRへ進まない
- [x] GoalとEvolutionがrestart後に復元される
- [x] unit / integration / E2E / adversarial testが通る
- [x] 単一repo / multi-repo回帰が通る
- [x] 対応OSで境界テストが通る
- [x] API変更時にSDKを再生成している
- [x] `bun script/build-docs-index.ts`でdocs indexを再生成している
- [x] `docs/evolve/completion-evidence.md`がコードとテストに照合済み
- [x] セキュリティ・プライバシーレビューに重大所見がない

## 20. Evidence manifest

最終PRで`docs/evolve/completion-evidence.md`を作成する。

```text
対象commit / branch / OS
multi-repo prerequisite
阻止条件 → code → test
soft evolution E2E
hard brief E2E
privacy / redaction
sandbox / adversarial
metrics / replay
restart / migration
rollback
Goal / Judge
SDK / docs
残存リスク
```

manifestの存在だけで完了にしない。記載内容を実際のログ、終了コード、成果物へ照合する。

## 21. リリース時の表現

完了前:

> oimoはmemory、skill、改善briefを生成する自己改善プレビューを提供します。生成品質、安全な自動適用、効果測定の完全保証はまだありません。

完了後:

> oimo Continuous Self-Evolutionは、根拠付きのソフト進化を検証・評価・rollback可能な形で採用し、製品共通問題は本体を直接変更せず検証済みの改造指示書として人間へ引き渡します。すべての変更経路は共通Policy、project / workspace scope、監査可能なEvolution stateで制御されます。

## 22. メンテナー最終報告テンプレート

```text
oimo Continuous Self-Evolution 完全版 監査結果

Prerequisite:
- multi-repo evidence:

Soft evolution:
- Dream:
- Distill:
- Project evolve:
- validation / activation / rollback:

Hard evolution:
- brief schema / validator:
- evidence / redaction:
- handoff:
- product source unchanged:

Safety / privacy:
- sandbox:
- adversarial tests:
- consent / retention:

Evaluation:
- baseline / after:
- HAC:
- scenario / replay:

Persistence / Goal:
- migration / restart:
- Goal / Judge:

Compatibility:
- single-repo:
- multi-repo:
- OS:

Generated artifacts:
- SDK:
- docs index:
- completion evidence:

Release blockers:
- none / list
```

残件がある場合はcompleteにせず、再現手順、影響範囲、安全な一時運用、次の担当を記録する。

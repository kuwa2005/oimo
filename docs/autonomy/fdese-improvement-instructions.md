# FDE / SE 自律実行 改良指示書

作成日: 2026-09-18  
対象: oimo メンテナー、実装担当者、レビュアー  
対象機能: `oimo --se`、`oimo --fde`、`/auto normal`、`/auto fde`  
状態: 実装・レビュー・リリース判定の指示書

## 1. 目的

`--se` と `--fde` を、長いプロンプトと複数の暗黙フラグで動く機能から、次の性質を持つ製品機能へ改良する。

- 起動方法によらず同じ意味になる
- セッション再開、プロセス再起動、TUI途中切替で状態を失わない
- SEとFDEの違いが型と状態遷移で表現される
- 要件ロック、Solution Lock、完了、待機、失敗を文字列推測に依存しない
- 実行したテストと結果を機械的な証拠として扱う
- 同じテスト失敗や同じJudge指摘で無限に回らない
- 安全な操作だけを自動承認し、高リスク操作は自律モードでも人間へ戻す
- 単一repoとマルチリポジトリの双方でscopeを保持する
- テスト自体がグローバル環境、TTY、Worker、時間、モジュールキャッシュに依存しない

本書は、既存機能を削除する指示ではない。CLI互換性を保ちながら内部契約を置き換える。

## 2. 実装順序

推奨順序は次とする。

```text
マルチリポジトリ完全対応
  → FDE / SE実行基盤の改良
  → oimo Continuous Self-Evolution完全版
```

理由:

- FDEは現場課題を複数repoへ展開するため、先にWorkspace / Change set / Policyが必要
- oimo進化の実装作業そのものがSE/FDEのGoal・Judge・テスト証拠を利用する
- 不安定な自律ループを自己進化のschedulerへ接続してはならない

着手条件:

- `docs/multi-repo/completion-evidence.md`が存在する
- shell、file、Git、workflowが共通Policyを通る
- Workspace、Repository、Change set、Goalが再開可能である

## 3. 配置

`docs/architecture/core-vs-skills.ja.md`に従う。

| 能力 | 配置 |
|---|---|
| 実行profile、状態機械、永続化、権限、証拠、Judge、CLI、TUI | `packages/opencode`本隊 |
| SE/FDEの作業手順、質問例、成果物テンプレート | compose内部skill / prompt |
| repo固有の仕様・計画・報告 | `<repo>/.oimo/`または設定済みcompose docs dir |
| 汎用テスト戦略 | agent-skillsへのportable版を検討 |

本機能はセッションと安全性の不変条件なので、スキルだけで実装してはならない。

## 4. 現状評価

### 4.1 再利用するもの

- `ConfigAutonomy.Info`の予算設定
- SE / FDEの基本的な役割定義
- compose agentとの統合
- `Question`、`Permission`、`Goal`、Bus eventの基盤
- FDEのProblem First、Level 1–3、PoC First
- Goal Judgeの独立モデルという考え方
- Friction LearningのSE / FDE lens
- try-best、rate-limit recovery、loop detectionの既存部品
- TUI `/auto`とGoal表示

### 4.2 確認したテスト結果

2026-09-18時点で次を実行した。

```text
bun test test/config/autonomy.test.ts test/session/goal.test.ts test/friction/learning.test.ts
→ 35 pass / 0 fail

bun test test/cli/help.test.ts test/cli/tui/thread.test.ts
→ 4 pass / 4 fail
→ CLI子プロセスが各5秒でtimeout、exit 143

bun src/index.ts --help
→ exit 0だが約8.7秒
```

CLIテストの失敗は`--se`の判断品質ではなく、help表示でも全entrypointを起動し、初期化コストを負うテスト構造による。既存レポートにも、同テストは30秒timeout前提で1ファイル約60秒と記録されている。

### 4.3 リリース阻止条件

次が一つでも残る間、改良完了としない。

1. modeがCLI引数、静的`Flag`、`process.env`、Config、TUI local、Question、Permissionへ重複している。
2. `MIMOCODE_AUTONOMY`等がimport時評価で、途中の`process.env`変更を正しく反映しない。
3. `/auto`がprocess envとglobal configを書き換え、別session / projectへ影響し得る。
4. `normal`がSEを意味し、公開名と内部名が一致しない。
5. `oimo --se --fde`は許可する一方、`oimo session list --se --fde`は拒否する。
6. `--se --fde`のpersonaとFriction lensの合成規則が型で表現されていない。
7. GoalがInstanceState内だけにあり、instance teardownで消える。
8. phaseが`hearing | execute`だけで、lock待ち、verify、judge、blockedを表現できない。
9. process-global `goalRef`とfire-and-forget `Effect.runFork`でphase更新が競合し得る。
10. lock判定が質問headerと肯定語regexに依存する。
11. 複数質問のどれかに`yes`があれば、lock質問が`Changes needed`でも承認され得る。
12. 完了とユーザー待機を`isAwaitingUserOrDone`という一つのbooleanへ潰している。
13. hearing / execute phaseだけから`waiting_user`と`completed`を推測している。
14. 「完了しました」等の自然文だけでJudgeを通さずcompletedになり得る。
15. execute中の「確認待ち」をcompletedとして扱い得る。
16. Judgeが全文transcriptを毎回読み、証拠manifestを持たない。
17. Judge unavailable時の扱いが通常Goalとautonomyで異なる。
18. 同じテスト、同じ失敗、同じ修正を繰り返すbudgetが独立していない。
19. 全タスクで新しいテストプログラムと文書を要求し、変更規模に比例しない。
20. docs-only、設定変更、既存テストで十分な変更でも新規テスト作成へ誘導する。
21. テスト失敗を製品failure、環境failure、flake、無関係failureに分類しない。
22. 実テスト結果でなくassistantの文章をJudgeが証拠と見なせる。
23. autonomyが実質allow-all permission baseを暗黙有効化する。
24. FDEの外部送信、顧客データ、production操作の承認境界が型になっていない。
25. CLI smoke testがDB migrationを伴う重いentrypointを毎回spawnする。
26. TUI testが`process.chdir`、`process.env`、TTY、Worker、module spyを直接変更する。
27. Bun module cacheのリークをコメントと運用で回避している。
28. Goalの主要なstop / resume / judge / lock経路に決定的E2Eがない。
29. 単一repo / multi-repoでGoalと証拠scopeが一致する保証がない。
30. TUIに「現在何を待っているか」「次に何をするか」が構造化表示されない。

## 5. 新しい公開概念

### 5.1 Execution Profile

次を唯一の正規表現とする。

```ts
type AutonomyProfile = "off" | "se" | "fde" | "super_auto"

type LearningLens = "se" | "fde"

type AutonomyRequest = {
  profile: AutonomyProfile
  learningLenses: LearningLens[]
  source: "cli" | "session_list" | "config" | "tui"
  permissionPreset: "interactive" | "safe_auto" | "full_auto"
}
```

- `normal`は内部・API・UIから段階的に廃止し、`se`へ統一する。
- 互換期間は`normal -> se`を入力aliasとしてだけ受け付ける。
- `--fde`のprofileは`fde`。
- `--se --fde`は後方互換として受理し、`profile=fde`、`learningLenses=["se","fde"]`へ一度だけ正規化する。
- `session list`、直接TUI起動、環境変数、設定、`/auto`で同じresolverを使う。
- 競合フラグの解釈を各handlerへ重複実装しない。

### 5.2 Run State

```ts
type AutonomyPhase =
  | "discover"
  | "lock_pending"
  | "execute"
  | "verify"
  | "judge"
  | "waiting_user"
  | "completed"
  | "blocked"
  | "cancelled"

type AutonomyRun = {
  id: AutonomyRunID
  session_id: SessionID
  project_id: ProjectID
  workspace_fingerprint?: string
  repository_ids: RepositoryID[]
  changeset_id?: ChangeSetID
  profile: AutonomyProfile
  learning_lenses: LearningLens[]
  phase: AutonomyPhase
  revision: number
  user_request: string
  locked_scope?: LockedScope
  active_gate_id?: GateID
  evidence_manifest_id?: EvidenceManifestID
  budgets: AutonomyBudgets
  counters: AutonomyCounters
  stop_reason?: AutonomyStopReason
  created_at: number
  updated_at: number
}
```

RunはDBへ永続化し、sessionとの外部キーを持つ。再起動時は最新revisionから復元する。

### 5.3 Stop Reason

最低限、次を区別する。

```text
completed
waiting_for_lock
waiting_for_required_input
blocked_environment
blocked_permission
blocked_dependency
budget_model_turns
budget_test_attempts
budget_judge_attempts
budget_duration
budget_cost
judge_unavailable
repeated_failure
cancelled_by_user
invalid_state
```

`impossible`へ多くの原因を集約しない。再開可能性と担当者を判定できる粒度を保つ。

## 6. 状態機械

### 6.1 SE

```text
discover
  → lock_pending
  → execute
  → verify
  → judge
  → completed
```

分岐:

- 質問が必要: `discover -> waiting_user -> discover`
- Requirements Lock変更要求: `lock_pending -> discover`
- 実装blocker: `execute -> blocked`
- verification failure: `verify -> execute`。同一failure上限超過で`repeated_failure`
- Judge不足指摘: `judge -> execute | verify`
- cancel: 任意phaseから`cancelled`

### 6.2 FDE

```text
discover(field observation)
  → option_analysis(Level 1–3としてdiscover内substate)
  → poc(optional)
  → lock_pending
  → execute
  → verify(outcome + operability)
  → judge
  → completed
```

PoCはproduction implementationではない。PoC成果物には以下を記録する。

- hypothesis
- smallest experiment
- result
- decision impact
- disposable / promoted

PoCが不要なら理由を記録する。形だけのPoCを強制しない。

### 6.3 遷移規則

- 全遷移は`AutonomyService.transition(runID, event)`だけを通す。
- prompt、TUI、Question toolが直接phaseを書き換えない。
- 許可されない遷移は`invalid_state`として監査し、fail closedする。
- transitionはDB transactionとrevision compare-and-swapを使う。
- 同一event IDは冪等にする。
- Bus eventは永続状態更新後にpublishする。

## 7. 起動・設定の統一

### 7.1 Resolver

純関数`resolveAutonomyRequest()`を作る。

入力:

- CLI parse結果
- session list転送値
- project / global config
- 明示された環境変数snapshot

出力:

- canonical `AutonomyRequest`
- warnings
- validation errors
- compose agent推奨

優先順位を一箇所で定義し、表形式テストを作る。

### 7.2 環境変数

- `Flag.MIMOCODE_AUTONOMY`等のimport時定数をruntime modeの真実にしない。
- CLI envはworker bootstrap入力へ変換したら捨てる。
- `/auto`でprocess-global envを変更しない。
- compatibility envは起動時だけ読む。
- testでは`EnvSnapshot`を値として注入する。

### 7.3 `/auto`

- 既定では現在sessionのRunだけを変更する。
- global default変更は別操作`/auto default`に分離する。
- `off -> se/fde`は新Run作成または明示resume。
- `se <-> fde`は既存lockを自動流用しない。差分を表示し、再lockする。
- `se/fde -> super_auto`は危険度上昇として明示承認する。
- mode変更に失敗した場合、TUI local、server state、永続configを部分更新しない。

## 8. Lock Gate

### 8.1 構造化gate

header regexを認証情報として使わない。

```ts
type AutonomyGate = {
  id: GateID
  run_id: AutonomyRunID
  kind: "requirements_lock" | "solution_lock" | "high_risk_action"
  revision: number
  proposal_hash: string
  question_request_id: string
  options: ["approved", "changes_needed"]
  status: "pending" | "approved" | "changes_needed" | "expired"
}
```

- UI表示用headerは翻訳可能だが、判定は`kind`で行う。
- 承認は対応する質問indexの回答だけを見る。
- gate作成後にproposalが変わればhash不一致で承認を失効する。
- 承認者、時刻、対象scopeを監査する。
- 複数質問の別回答でlockを誤承認しない。
- `goalRef`を廃止し、Question serviceからAutonomy serviceへ型付きeventを送る。
- phase遷移完了をawaitしてからtool resultを返す。

### 8.2 Locked Scope

```ts
type LockedScope = {
  objective: string
  acceptance_criteria: string[]
  in_scope: string[]
  out_of_scope: string[]
  repositories: RepositoryID[]
  risks: string[]
  verification_plan: VerificationPlan
  hash: string
}
```

ロック後のscope変更は小さくても記録する。material changeなら再lockする。

## 9. 権限と安全性

### 9.1 safe_auto

SE/FDEの既定は`safe_auto`とし、allow-allと同義にしない。

自動許可候補:

- workspace内read / search
-許可されたChange set内の非機密ファイル編集
-既知の非破壊的test / lint / typecheck
-一時領域への生成

必ず人間確認:

- 削除、履歴破壊、force push
- production / cloud / DB変更
- 外部送信、公開、PR merge
- 課金、契約、購入
- credential / auth / permission変更
- PII、顧客データの移動
- workspace外書込
- multi-repo plan外repoへの変更

コマンド文字列regexだけで危険度を決めない。tool intentとresolved targetをPolicyへ渡す。

### 9.2 FDE固有

現場調査で得たデータは最小化し、secret / PIIを仕様書、Friction、ログへ複製しない。PoCが実データを必要とする場合は、匿名化データまたは明示承認を使う。

## 10. Verification Planner

### 10.1 テストの目的

テスト数や文書量を増やすことを目的にしない。locked acceptance criteriaに対して、最小で十分な証拠を作る。

### 10.2 変更分類

変更前にVerification Plannerが分類する。

| change kind | 最低限の検証 |
|---|---|
| docs-only | link、format、generated index、diff check。新規unit test不要 |
| config / schema | parser / migration / invalid input test |
| pure logic | focused unit + typecheck |
| integration | 実サービス境界または既存integration test |
| TUI | reducer / stateのunit + PTYまたはrender integration |
| CLI parse | parser純関数test。entrypoint spawnは代表caseだけ |
| filesystem / Git | 実tmp repo。mockを避ける |
| multi-repo | fixture workspaceでscope、順序、partial failure |
| security | adversarial test必須 |

「単一HTMLでも必ず別テストプログラムを作る」という一律規則は削除する。動作ロジックがあれば検証可能に分離するが、静的成果物に無意味なテスト用コードを追加しない。

### 10.3 Test Attempt

各実行を構造化保存する。

```ts
type TestAttempt = {
  id: TestAttemptID
  run_id: AutonomyRunID
  command: string[]
  cwd_repository_id: RepositoryID
  environment_fingerprint: string
  code_revision: string
  started_at: number
  duration_ms: number
  exit_code: number | null
  status: "passed" | "failed" | "timed_out" | "cancelled" | "infra_error"
  failure_signature?: string
  stdout_artifact?: ArtifactID
  stderr_artifact?: ArtifactID
}
```

Judgeはassistantの「テスト成功」ではなく、TestAttemptを参照する。

### 10.4 失敗分類

```text
product_failure       変更対象の不具合
test_failure          テスト期待値またはfixtureの不具合
environment_failure   toolchain、network、権限、OS
pre_existing_failure  基準commitでも再現
unrelated_failure     対象scope外
flake                 同一revision・同一環境で結果が揺れる
unknown               未分類
```

`unknown`のまま成功扱いしない。pre-existing / unrelatedを主張する場合はbaseline再現証拠を残す。

### 10.5 Retry規則

- 同じrevision、同じcommand、同じfailure signatureの再実行は原則1回まで。
- 再実行前に「何が変わったか」をeventへ記録する。
- code / fixture / environmentのいずれも変化していなければ再実行しない。
- flake確認は固定回数とし、成功するまで回さない。
- timeout値を上げるだけの修正は、性能budgetと原因説明なしでは不可。
- 同一failureが上限に達したら`repeated_failure`で止め、人間へ証拠を渡す。

### 10.6 テストbudget

model turnとは別に持つ。

```ts
type VerificationBudget = {
  max_total_duration_ms: number
  max_attempts: number
  max_attempts_per_signature: number
  max_full_suite_runs: number
}
```

focused test → package typecheck → relevant suiteの順に進める。毎修正後にfull suiteを回さない。

## 11. CLIテストの改良

### 11.1 parseと起動を分離

`src/index.ts`全体をspawnしなくても次を検証できるAPIを作る。

```ts
parseCli(argv, envSnapshot): CliIntent
renderHelp(command): string
resolveTuiLaunch(intent): TuiLaunchRequest
```

- help、unknown flag、`--se` / `--fde`合成はprocess spawnなしでunit testする。
- `CliIntent`からcanonical `AutonomyRequest`を得る。
- DB、plugin、provider、migrationはhelp生成に不要。

### 11.2 spawn smoke

spawn testは次だけに絞る。

- 配布相当binaryの`--help`
- `--version`
- `session list --format=json`の最小fixture
- TUI bootstrapの代表1件

要件:

- command固有timeoutを明示
- timeout時にstdout / stderr / active handlesを保存
- 子process treeを確実に終了
- migration完了待ちとhelp生成を混ぜない
- CI性能budgetを設定し、helpは目標1秒未満とする

単に既定timeoutを30秒へ上げてgreenにすることを完了としない。

## 12. テスト容易性のための依存性除去

- `process.env`を直接変更せず、`EnvSnapshot`を注入する。
- `process.chdir`をhandler内部で行う前にlaunch requestを純粋計算する。
- TTYは`TerminalCapabilities`として注入する。
- Worker生成は`WorkerFactory`へ分離する。
- clock、ID、cost計算をserviceとして注入する。
- module-level Map、process-global bridge、import-time flagを廃止する。
- test間の`mock.module()` cache挙動へ依存しない。
- Effect service testは`test/AGENTS.md`どおり`testEffect`と`provideTmpdirInstance`を使う。
- filesystem / Git / lockのtestは`it.live`を使う。
- 実装ロジックをtestへ複製しない。

## 13. Evidence ManifestとJudge

### 13.1 Manifest

```ts
type AutonomyEvidenceManifest = {
  run_id: AutonomyRunID
  locked_scope_hash: string
  changed_repositories: RepositoryID[]
  changed_files: string[]
  acceptance: Array<{
    criterion: string
    evidence_ids: EvidenceID[]
    status: "met" | "not_met" | "blocked" | "not_applicable"
  }>
  test_attempt_ids: TestAttemptID[]
  security_checks: EvidenceID[]
  unresolved: string[]
  generated_at: number
}
```

tool resultから自動生成し、assistantが自由文でpassへ書き換えられないようにする。

### 13.2 Judge入力

Judgeには次を渡す。

- locked scope
- manifest
- manifestが参照する必要最小限のtool evidence
- unresolved blockers
- 最終diff summary

全文transcriptは補助情報に下げる。秘密を含む巨大tool outputを毎回再送しない。

### 13.3 Verdict

```ts
type JudgeVerdict = {
  status: "complete" | "rework" | "blocked" | "inconclusive"
  criterion_results: Array<{
    criterion: string
    status: "met" | "missing" | "blocked"
    evidence_ids: EvidenceID[]
    reason: string
  }>
  next_action?: "execute" | "verify" | "ask_user" | "stop"
}
```

- Judge errorをcompleteへ変換しない。
- `judge_unavailable`として再開可能に停止する。
- 同じmissing criteriaを同じevidence revisionで再Judgeしない。
- model Judgeだけでなく、必須test failureなど決定的条件を先に機械判定する。

## 14. 完了・待機判定

`isAwaitingUserOrDone(): boolean`を主判定から外す。

優先順位:

1. 明示的なQuestion / Permission / Gate pending event
2. state machine上のphase
3. tool / test / Judgeの構造化結果
4. provider finish reason
5. 自然文classifierは補助signalのみ

自然文classifierを使う場合も結果を分ける。

```ts
type HandoffSignal =
  | { kind: "none" }
  | { kind: "claims_complete"; confidence: number }
  | { kind: "awaits_user"; confidence: number; topic?: string }
  | { kind: "announces_next_step"; confidence: number }
```

`claims_complete`はJudgeを起動するsignalであり、completedの証拠ではない。`awaits_user`はpending gateが存在する場合だけ自動停止理由に採用する。

## 15. Friction Learningとの分離

- execution profileとlearning lensを別フィールドにする。
- `/auto`切替でlensがimport-time flagに取り残されないようにする。
- lensはRunにsnapshotし、途中変更を監査する。
- task-specificな失敗を即general ruleへ昇格しない。
- test infra failureを「ユーザー要件不足」として学習しない。
- repeated test failureは、製品、テスト、環境の分類後にだけFriction候補へ送る。
- secret、PII、生の長大ログをFriction成果物へ保存しない。

## 16. マルチリポジトリ統合

- Runは`workspace_fingerprint`、`repository_ids`、`changeset_id`を持つ。
- Locked Scopeに対象repoと検証順序を含める。
- repoごとにcwdを明示したTestAttemptを保存する。
- 共有schema → backend → frontend等のverification DAGを使用する。
- 一つのrepoが失敗しても他repoの成功で全体completeにしない。
- plan外repoへのwriteは再lock対象。
- FDEのLevel 1案が単一repoで済み、Level 2/3が横断変更なら、そのコスト差を提示する。
- workspace知識とrepo固有知識を混ぜない。

## 17. TUI要件

TUIを主実装面とする。Web / App対応は対象外。

表示:

- profile: SE / FDE / Super Auto
- phase
- locked scope revision
- 対象repo / Change set
- 現在待っているgate / permission / blocker
- model / test / judge budget
- 直近test statusとfailure分類
- acceptance criteriaの達成数
- stop reasonと再開方法

操作:

- pause / resume
- cancel
- request changes
- approve lock
- retry classified failure
- profile切替
- evidence表示
- safe_auto permission policy表示

色だけで状態を区別しない。再起動後も同じ表示を復元する。

## 18. API / SDK

最低限のAPI:

```text
POST /autonomy/runs
GET  /autonomy/runs/:id
POST /autonomy/runs/:id/transition
POST /autonomy/runs/:id/pause
POST /autonomy/runs/:id/resume
POST /autonomy/runs/:id/cancel
GET  /autonomy/runs/:id/evidence
POST /autonomy/gates/:id/respond
```

- `/config/autonomy-mode`は互換adapterへ縮小する。
- APIはdirectory headerだけでなくrun / project / workspace bindingを検証する。
- schema変更後は`./packages/sdk/js/script/build.ts`でJavaScript SDKを再生成する。
- generated SDK差分を手編集しない。

## 19. 必須テスト

### 19.1 Unit

- 全CLI / env / config組合せのprofile resolver
- `--se --fde`のcanonical結果
- mode alias migration
- 全許可・不許可状態遷移
- gate回答indexのbinding
- proposal hash変更による承認失効
- verification plan分類
- failure signatureとretry decision
- HandoffSignal分類。ただし主状態を自然文だけで変更しないこと
- permission risk分類
- manifest deterministic生成

### 19.2 Integration

- CLI intent → Run作成 → compose選択
- SE hearing → Requirements Lock → execute
- FDE discovery → PoC → Solution Lock → execute
- changes needed → discoverへ戻る
- restart後にRun、gate、budget、evidenceを復元
- `/auto`が現在sessionだけを変更
- SE ↔ FDE切替で再lock
- test failure →修正→fresh test pass→Judge complete
- Judge unavailable →再開可能停止
- permission pending →waiting状態
- Friction lensがlive switch後もRunと一致

### 19.3 Adversarial

- 別質問の`yes`でlockされない
- assistantが`完了しました`と書くだけではcompleteにならない
- execute中の「確認待ち」をcompletedにしない
- fake test outputをmanifestへ登録できない
- stale test passを編集後に再利用しない
- 同一failureを無限retryしない
- mode変更のpartial failureで権限だけ緩まない
- process Aのenv / goalがprocess Bへ漏れない
-別projectのRun / gateへ回答できない
- plan外repoへ書けない
- symlink経由でscope外へ書けない

### 19.4 E2E

#### SE成功

1. 曖昧な依頼を入力する。
2. structured questionで要件を確認する。
3. Requirements Lock変更要求では実装しない。
4. 修正版を承認する。
5. locked scope内だけ変更する。
6. Verification Plannerがfocused testを実行する。
7. manifestがfresh evidenceを持つ。
8. Judgeがcriterion単位でcompleteにする。
9. restart後もcompleted stateと証拠を表示できる。

#### FDE成功

1. 表面的な機能要求から現場workflowを調べる。
2. Level 1–3を比較する。
3. 必要な最小PoCを実行する。
4. Solution Lockを得る。
5. 選択案を実装し、技術testと現場acceptanceを検証する。
6. Before/Afterが測れる場合だけ記録する。
7. 最大3件の次改善を優先順位付きで示す。
8. 製品目的と運用可能性をJudgeが確認する。

#### Test failure

1. 意図的なproduct failureを発生させる。
2. failure signatureを保存する。
3. 変更なしの同一command連打を拒否する。
4. 修正後だけ再実行する。
5. unrelated baseline failureを注入し、対象failureと区別する。
6. budget超過時はrepeated_failureとして証拠付き停止する。

#### CLI性能

1. parser unit testはprocess spawnなしで完了する。
2. `--help` smokeが性能budget内で終了する。
3. timeout時は診断artifactを残し、dangling processを残さない。

## 20. テスト実装規約

- testsは`packages/opencode`から実行する。
- dependency installが必要ならrepo rootで`bun ci`だけを使う。
- typecheckは`packages/opencode`で`bun typecheck`を使う。
- mockより実装を使う。
- Goal / Autonomy serviceは`testEffect`を使う。
- filesystem / Git / clock依存integrationは`it.live`を使う。
- 固定sleepで同期しない。event、latch、TestClockを使う。
- test順序へ依存しない。
- process env変更時は必ずsnapshot restoreするが、最終的にはenv注入へ移行する。
- timeoutを増やして解決扱いにしない。
- skipped testを合格数へ含めない。
- flaky testを無制限retryしない。

推奨コマンド:

```bash
cd packages/opencode
bun test test/autonomy
bun test test/cli/autonomy.test.ts
bun test test/session/autonomy-run.test.ts
bun test test/session/autonomy-e2e.test.ts
bun typecheck
```

ファイルは新しい`test/autonomy/`へ機能横断の状態機械testを集約し、既存testは各moduleのunit testとして残す。

## 21. Observability

構造化event:

```text
autonomy.run.created
autonomy.phase.changed
autonomy.gate.created
autonomy.gate.responded
autonomy.permission.pending
autonomy.test.started
autonomy.test.finished
autonomy.failure.classified
autonomy.judge.started
autonomy.judge.finished
autonomy.run.stopped
```

eventにはrun ID、session ID、project ID、revisionを含める。prompt全文、secret、PII、生の大出力を既定で記録しない。

指標:

- lockまでのturn数
- lock後のrework回数
- 同一failure retry数
- test wall time
- Judge call数 / failure率
- false completion率
- waiting_userからresumeまで
- permission escalation数
- task種別ごとの成功率

指標最適化のために検証を省略しない。guardrailとしてsecret incident、scope escape、false passを置く。

## 22. Migration

1. 新schemaとRun serviceをfeature flag下で追加する。
2. 既存`autonomy.enabled/hearing_first/persona`をprofileへ読むadapterを追加する。
3. CLI resolverを共通化する。
4. 新旧両方へshadow eventを流し、差分を記録する。
5. lock、test evidence、Judgeを新Runへ移す。
6. TUIを新Run表示へ切り替える。
7. `goalRef`、import-time autonomy flags、boolean完了判定を削除する。
8. `normal` API aliasをdeprecatedにする。
9. compatibility期間後に旧pathを削除する。

既存の進行中Goalは、復元可能な情報が不足する場合に自動completeへしない。`blocked`として利用者へ再lockまたは新Run開始を案内する。

## 23. 推奨PR順序

1. baseline、現行behavior table、既知failureの固定
2. canonical profile resolverとCLI pure parser
3. AutonomyRun DB schema / migration / service
4. typed state transitionとevent
5. structured Lock Gateと`goalRef`除去
6. session-scoped `/auto`とenv/global state除去
7. safe_auto permission policy
8. Verification Planner / TestAttempt / failure classifier
9. Evidence Manifest
10. deterministic gate + Judge
11. SE prompt / compose手順の薄型化
12. FDE prompt / PoC / outcome verification
13. Friction lens分離
14. multi-repo binding
15. TUI
16. API / SDK
17. E2E / adversarial / performance
18. docs / migration / completion evidence

各PRに次を記載する。

- 閉じるリリース阻止条件
- 状態遷移への影響
- 権限への影響
- migration / rollback
- focused test結果
- performance差分
- 残件

## 24. Goal要件

実装開始時に次を`/goal`へ設定する。

```text
docs/autonomy/fdese-improvement-instructions.mdの全要件を実装し、--seと--fdeを
canonical profile、永続Run状態機械、構造化Lock Gate、safe_auto権限、Verification Planner、
TestAttempt、Evidence Manifest、決定的Judgeへ移行する。

直接TUI、session list、設定、環境変数、/autoの意味が一致し、restart後もRunを復元でき、
自然文だけでlockまたはcompleteにならず、同じtest failureを無限反復せず、単一repoとmulti-repoで
scopeを越えず、unit/integration/E2E/adversarial/performance testとcompletion evidenceが揃った場合だけ達成とする。

timeout延長だけ、prompt調整だけ、部分成功、未実行、skipped、flakeの無制限retry、既知のstate leak、
assistant自己申告によるtest passまたはcompleteは達成としない。
```

## 25. 完了条件

- [ ] multi-repo prerequisiteが完了している
- [ ] profile resolverが全入口で共通である
- [ ] `normal`がcanonical stateから消えている
- [ ] `--se --fde`規則が全入口で一致する
- [ ] import-time flagをruntime stateに使用していない
- [ ] `/auto`が別session / projectを暗黙変更しない
- [ ] RunがDBへ永続化されrestart復元できる
- [ ] 状態遷移がtyped、transactional、idempotentである
- [ ] process-global `goalRef`がない
- [ ] lockがgate ID、質問index、proposal hashへbindingされる
- [ ] 自然文だけでlockされない
- [ ] 自然文だけでcompletedにならない
- [ ] SEとFDEのphase、成果物、完了条件が分離される
- [ ] autonomy既定権限がallow-allではない
- [ ] TestAttemptが実command結果を保存する
- [ ] 編集後にstale test passを使えない
- [ ] failure分類とretry budgetが機能する
- [ ] 同一failureを無限反復しない
- [ ] 変更種別に比例したverification planになる
- [ ] docs-onlyへ無意味な新規unit testを強制しない
- [ ] Judgeがmanifestとfresh evidenceを使う
- [ ] Judge unavailableをcompleteにしない
- [ ] CLI parser testがspawn不要である
- [ ] `--help`が性能budget内で終了する
- [ ] testがmodule cache、TTY、cwd、envのリークへ依存しない
- [ ] Friction lensがprofileから独立して永続化される
- [ ] 単一repo / multi-repo E2Eが通る
- [ ] adversarial testが通る
- [ ] TUIがphase、gate、test、budget、stop reasonを表示する
- [ ] API変更後にJS SDKを再生成している
- [ ] docs indexを再生成している
- [ ] `docs/autonomy/fdese-completion-evidence.md`が実ログへ照合済み
- [ ] 重大な安全・プライバシー所見がない

## 26. Completion Evidence

最終PRで`docs/autonomy/fdese-completion-evidence.md`を作る。

```text
target commit / branch / OS
multi-repo prerequisite
release blocker → code → test mapping
profile resolution matrix
state transition matrix
SE E2E
FDE E2E
lock adversarial
permission adversarial
verification / retry / flake
judge / evidence freshness
restart / migration
single-repo / multi-repo
CLI startup performance
typecheck / SDK / docs index
remaining risks
```

manifestの存在だけで完了にしない。command、exit code、duration、artifactへ照合する。

## 27. メンテナー最終報告テンプレート

```text
FDE / SE Autonomy 改良 監査結果

Prerequisite:
- multi-repo evidence:

Canonical profiles:
- CLI / env / config / TUI consistency:
- compatibility aliases:

State machine:
- persistence / restart:
- lock gates:
- stop reasons:

Safety:
- safe_auto policy:
- high-risk approvals:
- scope / multi-repo:

Verification:
- planner:
- test attempts:
- failure classification / retry budget:
- CLI performance:

Evidence / Judge:
- manifest freshness:
- deterministic checks:
- judge failure behavior:

Tests:
- unit:
- integration:
- E2E:
- adversarial:
- typecheck:

Generated:
- JS SDK:
- docs index:
- completion evidence:

Release blockers:
- none / list
```

残件がある場合はcompleteにせず、再現手順、影響範囲、安全な一時運用、再開地点を記録する。

# oimo の強み — 他コーディングエージェントとの比較

Open Mimo Code（CLI: `oimo`）が、一般的なコーディングエージェント・Codex・Claude Code・Cursor・OpenCode と比べて**何を得意とする製品か**を整理したドキュメントです。

> **前提:** oimo は [OpenCode](https://github.com/anomalyco/opencode) フォークです。TUI・LSP・MCP・プラグイン・多プロバイダー接続など OpenCode 系の基盤は共有します。本稿は **oimo 固有の追加価値** に焦点を当てます。  
> 競合製品の機能は日々変わるため、表は「2026-09 時点の oimo 実装」基準です（マルチリポ / Continuous Self-Evolution / **FDE·SE 自律実行** は formal COMPLETE）。各製品の最新仕様は公式ドキュメントを参照してください。

---

## 一言サマリー

| 製品 | 主な形態 | oimo との関係 |
|------|----------|----------------|
| **一般的なコーディングエージェント**（Aider, Cline, Continue 等） | CLI / IDE 拡張 / 単機能スクリプト | ターミナルネイティブ + **長期記憶・自己改善・マルチリポ・型付き自律ループ**まで一体 |
| **Codex**（OpenAI / ChatGPT 連携 CLI） | OpenAI エコシステム前提のエージェント | Codex OAuth **取り込み可**。加えて Zen 無料ルーター・evolve・SE/FDE 等 |
| **Claude Code** | Anthropic 公式 CLI エージェント | 認証・設定の **インポート可**。oimo 側でメモリ / evolve / Auto(無料) / 自律 Run を追加 |
| **Cursor** | IDE 一体型（エディタ + Agent） | **IDE ではない**。TUI + `serve`/`attach` でリモート分離。自己進化・Compose・SE/FDE は oimo 固有 |
| **OpenCode** | オープンソース TUI エージェント（oimo の upstream） | 同一コア。**記憶・evolve・Auto(無料)・マルチリポ・永続 AutonomyRun** 等を oimo が拡張 |

**oimo のポジション:** 「その場で書く」だけでなく、**要件ロック付きで自律実行し、証跡で完了判定し、案件をまたいで学び、無料枠を運用し、複数リポを安全に扱う** ターミナル製品。

---

## 比較マトリクス（oimo 固有の強み）

凡例: ● = oimo が製品として標準搭載 / 深く統合、◐ = 限定的・設定依存、— = oimo の主戦場外または upstream 同等

| 能力 | oimo | OpenCode | Cursor | Claude Code | Codex | 一般 CLI エージェント |
|------|:----:|:--------:|:------:|:-----------:|:-----:|:---------------------:|
| ターミナル TUI（SSH / サーバ分離） | ● | ● | — | ● | ● | ◐ |
| 多プロバイダー / MCP / LSP | ● | ● | ◐ | ◐ | — | ◐ |
| **SQLite FTS 持続メモリ**（`MEMORY.md` 等） | ● | — | ◐ | ◐ | ◐ | ◐ |
| **自動チェックポイント + コンテキスト再構築** | ● | — | ◐ | ◐ | ◐ | — |
| **`/context-limit` モデル別圧縮予算** | ● | — | — | — | — | — |
| **Self Evolution（`/evolve`）** | ● | — | — | — | — | — |
| **Friction / HAC 学習** | ● | — | — | — | — | — |
| **`/dream` / `/distill` 知識・ワークフロー結晶化** | ● | — | — | — | — | — |
| **Compose + `/compose-next` 仕様駆動** | ● | — | — | — | — | — |
| **ゴール / 停止条件 + 独立ジャッジ** | ● | — | — | — | — | — |
| **SE / FDE 自律プロファイル**（`--se` / `--fde` / `/auto`） | ● | — | — | — | — | — |
| **永続 AutonomyRun + 型付き状態機械** | ● | — | — | — | — | — |
| **構造化 Lock Gate**（要件 / Solution / 高リスク） | ● | — | — | — | — | — |
| **Evidence Manifest + TestAttempt 証跡** | ● | — | — | — | — | — |
| **safe_auto 権限**（allow-all ではない既定） | ● | — | — | — | — | — |
| **Auto Model (無料) + first-frame failover** | ● | — | — | — | — | — |
| **マルチリポ System Workspace**（Change set / Policy） | ● | — | — | — | — | — |
| **`--warm` ソフト continue** | ● | — | — | — | — | — |
| **同梱ビルトインスキル**（PDF/DOCX/research 等） | ● | ◐ | — | — | — | — |
| **Claude Code 認証インポート** | ● | — | — | （本体） | — | — |
| **Codex (ChatGPT) OAuth** | ● | ◐ | — | — | （本体） | — |
| **IDE 内インライン編集・Tab 補完** | — | — | ● | — | — | ◐ |

---

## カテゴリ別 — oimo にないもの / 向いていないこと

公平のため、先に限界を書きます。

- **IDE 一体体験** — Cursor のようなエディタ内 diff・Tab 補完・GUI Agent パネルは oimo の主眼ではありません（TUI + 外部エディタ併用が前提）。
- **単一ベンダー最適化の深さ** — Codex / Claude Code は各社モデル・課金・ポリシーに最適化されています。oimo は **横断ルーター + 拡張** です。
- **クラウド専用 SaaS ダッシュボード** — oimo はローカル CLI + 任意 `oimo serve` です。
- **完全無人の危険操作** — SE/FDE 既定は `safe_auto`。削除・外部送信・workspace 外などは人間確認（`high_risk_action` / ask）。Super Auto（`--spauto`）だけが明示リスク承認後の full_auto。

---

## 1. 一般的なコーディングエージェントとの差

「エージェント」と呼ばれるツールは多く、**1 セッションで patch を出す** 点では共通です。oimo が厚いのは **セッションをまたぐ運用層** と **再開可能な自律ループ** です。

### oimo 側

- **記憶:** プロジェクトメモリ・チェックポイント・タスクツリー（`T1` / `T1.1` …）が SQLite で永続化され、再開時に自動注入。
- **コンテキスト:** ウィンドウ逼迫前の自動チェックポイント、予算制御付きインジェクション、モデル別 `/context-limit`。
- **自己改善:** 摩擦をログし、`.oimo/skills/` や `~/.oimo/evolve/` に結晶化（後述）。
- **自律実行:** SE（Requirements Lock）/ FDE（Solution Lock + PoC）が **DB 上の AutonomyRun** として再開可能。自然文だけで「完了」にしない。
- **サブエージェント:** 並列 spawn・キャンセル・ライフサイクル追跡を本隊が所有。
- **スキル:** BM25 検索 + 同梱ビルトイン + `.oimo/skills/` ホットリロード。

### 一般エージェント側（典型）

- リポジトリ内の `AGENTS.md` / ルールファイル + 会話履歴が中心。
- 長期記憶やチェックポイントは製品・設定次第（多くは oimo ほど一体ではない）。
- 「自律モード」があっても **env フラグ + 長いプロンプト** に寄りがちで、ロック・証跡・再起動復元が型になっていないことが多い。
- 自己改善ループ（観測→定量化→スキル化→PR 草案）は標準装備されにくい。

**向いているユーザー:** 単発修正より、**同じコードベースを weeks 単位で回す** 人。現場課題を複数 repo にまたいで閉じたい人。

---

## 2. OpenCode との差（upstream）

OpenCode は oimo の土台です。以下は **oimo が追加した製品能力** です（OpenCode 本体には通常含まれません）。

| 領域 | oimo の追加 |
|------|-------------|
| 記憶 | FTS5 メモリ、チェックポイントライター、タスク進捗連携 |
| 自律 | `/goal` + **AutonomyRun 状態機械**、SE/FDE/`/auto`、Lock Gate、Evidence Manifest、TestAttempt、safe_auto |
| ワークフロー | Compose、`/compose-next`、`.oimo/workflows/` |
| 自己進化 | evolve / friction / dream / distill、backlog・briefs（formal COMPLETE） |
| ルーティング | **Auto Model (無料)** — Zen active 7 モデル + first-frame failover（[auto-free-fcc-sync.md](./auto-free-fcc-sync.md)） |
| 現場 | マルチリポ Workspace / Change set / Policy（[multi-repo/README.md](./multi-repo/README.md)）、`--fde` / `--se` / `--spauto`、`--warm` |
| 製品 | `oimo.jsonc` + JSON Schema、MiMo OAuth・音声、Claude/Codex インポート UX、`--help` 軽量パス |

OpenCode ユーザーが oimo に移る典型理由: **無料モデルの自動切替が止まらないこと**、**evolve でチーム知識が溜まること**、**マルチリポ案件を 1 TUI で扱うこと**、**SE/FDE がロックと証跡付きで再開できること**。

---

## 3. Cursor との差

Cursor は **エディタが本体** の Agent です。oimo は **ターミナルが本体** です。

### Cursor が強い領域

- ファイル内インライン編集、マルチファイル diff レビュー
- Tab 補完、@ シンボル参照、GUI からの Agent 操作
- 非エンジニアにも触れやすい UX

### oimo が強い領域

- **サーバ上のみ `oimo serve`、手元は `oimo attach`** — SSH 先の重い TUI を避けられる（[README](../README.md) 参照）
- **evolve 閉ループ** — 運用摩擦をスキル・ルール・backlog に変換（IDE 外の資産）
- **Auto(無料)** — API キーなしで Zen 無料プールを failover（Cursor のモデル選択とは別レイヤ）
- **Compose** — 仕様→実装→検証の段階オーケストレーションを CLI ワークフローとして固定
- **マルチリポ** — 1 セッションで複数 Git ルートをスコープ付きで操作
- **SE / FDE** — 要件/方針ロック後にノンストップ実装。TUI に phase / gate / test 予算 / stop reason を構造化表示

**併用イメージ:** 日常編集は Cursor、**長時間自律バッチ・サーバ作業・evolve・現場 FDE** は oimo、という分担が多いです。

---

## 4. Claude Code との差

Claude Code は Anthropic 公式のターミナルエージェントです。oimo は **Claude 認証・設定のインポート** に対応していますが、製品の芯は異なります。

### Claude Code が強い領域

- Claude モデル・課金・ツール仕様への最短経路
- `CLAUDE.md` / hooks エコシステム（コミュニティ慣習が成熟）

### oimo が強い領域

- **プロバイダ非依存** — Claude に加え OpenRouter / Codex / Zen / MiMo 等を同一 TUI で切替
- **Auto Model (無料)** — Claude 契約なしでも Zen 無料 7 モデルを router 可能
- **持続メモリ + チェックポイント** — oimo 形式の `MEMORY.md` / checkpoint / tasks 一体
- **Self Evolution** — `/evolve`、friction ルール、AI-to-AI briefs（Claude Code 単体にはない製品ループ）
- **マルチリポ・Compose・SE/FDE ゴール駆動** — 大規模・長期・現場案件向けの本隊機能

**移行:** 初回セットアップの「Claude Code からインポート」で認証を移しつつ、**記憶と evolve と AutonomyRun は oimo 側に蓄積** させる使い方が想定されています。

---

## 5. Codex との差

Codex（ChatGPT Pro/Plus 連携の OpenAI コーディング CLI）も **OAuth で oimo に接続可能** です。

### Codex が強い領域

- OpenAI サブスクリプション枠内での Codex モデル利用
- ChatGPT エコシステムとの一体課金・ポリシー

### oimo が強い領域

- **マルチプロバイダー** — Codex だけでなく Claude / MiMo / カスタム OpenAI 互換を同一セッション運用
- **Auto(無料)** — サブスク外の Zen 無料プールを first-frame failover（502/429 等の transient も router 側で処理）
- **記憶・evolve・Compose・自律証跡** — Codex セッションをまたいだプロジェクト知識と完了判定の保持
- **マルチリポ** — モノレポ / 複数サービス repo の横断

**典型:** 難しいタスクは Codex モデル、定常タスクは Auto(無料) や lite グループ、という **コスト分散**。長時間は `--se` / `--fde` でロック後に回す。

---

## 6. oimo 固有機能の詳細

### 6.1 Self Evolution（Co-Evolve）

```text
案件で使う
  → /evolve（Self Improvement Session）
  → 摩擦 / Human Attention Cost を定量化
  → プロジェクト知識 → .oimo/skills/
  → 製品改善 → ~/.oimo/evolve/<projectID>/briefs/
  → evolve-review → 人間承認 → evolve-apply（draft PR）
```

- ログは **`~/.oimo/evolve/<projectID>/`** に集約（作業ツリーを汚さない）
- ソースの **自動マージはしない** — Human-in-the-loop が前提
- README の *Where Models and Agents Co-Evolve* はこのループを指す
- formal scope は COMPLETE（[evolve/completion-evidence.md](./evolve/completion-evidence.md)）

関連: ビルトイン `evolve` スキル、`/dream`、`/distill`

### 6.2 Auto Model (無料)

- 公開 ID: `auto/free`（TUI: **Auto Model (無料)**）
- OpenCode Zen の **active 無料 7 モデル** を zero-config で候補化
- **first-frame failover** — 429 / 5xx / upstream 過負荷等、コミット前なら次モデルへ（[auto-free-fcc-sync.md](./auto-free-fcc-sync.md)）
- FCC 由来 OpenRouter / NVIDIA / Groq は API キー設定時にボーナス候補

将来: `auto/paid` / `auto/hybrid`（[auto-mode-roadmap.md](./auto-mode-roadmap.md)）

### 6.3 マルチリポジトリ

- `.oimo/repos.txt` または `.oimo/workspace.yaml` で複数 Git ルートを登録
- `oimo repos doctor` / `plan` / `approve`、`/repos`、書込スコープゲート、Change set 永続化
- AutonomyRun に `repository_ids` / workspace fingerprint を束縛し、再開時に scope を失わない
- 詳細: [multi-repo/README.md](./multi-repo/README.md)、証跡 [multi-repo/completion-evidence.md](./multi-repo/completion-evidence.md)

### 6.4 SE / FDE 自律実行（Autonomy）

「長いシステムプロンプト + 暗黙フラグ」ではなく、**起動経路によらず同じ意味になる製品機能**です。

| 入口 | 正規プロファイル | 要点 |
|------|------------------|------|
| `oimo --se` / `/auto se` | `se` | ヒアリング → **Requirements Lock** → 実装・検証・Judge |
| `oimo --fde` / `/auto fde` | `fde` | 現場観察 → Level 1–3 / PoC → **Solution Lock** → 実装 |
| `oimo --se --fde` | `fde` + lenses `[se,fde]` | 後方互換の合成（全入口で同一規則） |
| `oimo --spauto` | `super_auto`（UI: special） | 起動時に赤警告 → ヒアリングなし full_auto |

差別化の核:

- **AutonomyRun（SQLite）** — phase / revision CAS / 再起動復元。セッション切替でも process-global env に依存しない（`/auto` 既定は session scope）
- **構造化 Lock Gate** — gate ID + 質問 index + proposal hash。別質問の「yes」で誤ロックしない
- **Evidence Manifest + TestAttempt** — 実コマンド結果のみを証跡に。stale pass・同一 failure の無限ループを予算で止める
- **Verification Planner** — docs-only に無意味な unit test を強制しない
- **safe_auto** — SE/FDE 既定は allow-all ではない。高リスクは `high_risk_action` へ戻せる
- **独立 Judge** — 自然文の「完了しました」だけでは completed にしない。`judge_unavailable` ≠ complete

```text
discover → lock_pending → execute → verify → judge → completed
                ↕ waiting_user / blocked / cancelled
```

関連: [autonomy/fdese-improvement-instructions.md](./autonomy/fdese-improvement-instructions.md)、証跡 [autonomy/fdese-completion-evidence.md](./autonomy/fdese-completion-evidence.md)

### 6.5 コンテキスト・継続性

| 機能 | 用途 |
|------|------|
| 自動チェックポイント | 長セッションの状態スナップショット |
| `--warm` | 新規セッションへ前回要約を 1 ターン注入（`-c` よりソフト） |
| `--warm=deep` | compaction 境界まで `contextFrom` 継承 |
| `/context-limit` | モデル別に早め圧縮（コスト・品質調整） |
| AutonomyRun 復元 | プロセス再起動後も phase / lock / 予算を継続 |

---

## 7. 選び方（クイックガイド）

| あなたの優先 | おすすめ |
|--------------|----------|
| IDE 内で書きながら Agent | **Cursor**（oimo は補助） |
| Claude だけ・公式 CLI で十分 | **Claude Code** |
| ChatGPT サブスクで Codex だけ | **Codex** |
| OSS TUI・自分で最小構成 | **OpenCode** |
| 無料枠 failover + 長期記憶 + 自己改善 + マルチリポ | **oimo** |
| 要件ロック付きの長時間自律 / 現場 FDE | **oimo**（`--se` / `--fde`） |
| 既に OpenCode ユーザーで evolve / Auto(無料) / 自律 Run が欲しい | **oimo** へ |

---

## 8. 関連ドキュメント

| ドキュメント | 内容 |
|--------------|------|
| [README.md](../README.md) | クイックスタート・機能一覧 |
| [architecture/core-vs-skills.ja.md](./architecture/core-vs-skills.ja.md) | 本隊 / ビルトイン / スキルの境界 |
| [auto-free-fcc-sync.md](./auto-free-fcc-sync.md) | Auto(無料) カタログと Zen プール |
| [auto-mode-roadmap.md](./auto-mode-roadmap.md) | Auto paid / hybrid ロードマップ |
| [multi-repo/README.md](./multi-repo/README.md) | マルチリポ利用ガイド |
| [multi-repo/completion-evidence.md](./multi-repo/completion-evidence.md) | マルチリポ formal COMPLETE |
| [evolve/completion-evidence.md](./evolve/completion-evidence.md) | Self-Evolution formal COMPLETE |
| [autonomy/fdese-improvement-instructions.md](./autonomy/fdese-improvement-instructions.md) | SE/FDE 改良指示書 |
| [autonomy/fdese-completion-evidence.md](./autonomy/fdese-completion-evidence.md) | SE/FDE formal COMPLETE |
| ビルトイン `mimocode-docs` | TUI 内リファレンス（`/` でスキル検索） |

---

## 更新方針

- 競合製品の機能追加が oimo の差分を埋める場合は、本稿の表を更新する。
- oimo 側の新機能（例: `auto/hybrid` 実装）が出たら、該当セクションと [auto-mode-roadmap.md](./auto-mode-roadmap.md) を同期する。
- 自律・マルチリポ・evolve の COMPLETE 境界が動いたら、§6 と関連証跡リンクを同期する。

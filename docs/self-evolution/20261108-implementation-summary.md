# 自己進化ループ閉鎖 — 実装サマリ（2026-11-08）

- 関連: [ヒアリング](./20261108-hearing.md)、ルート報告書 [`自己進化202611108.md`](../../自己進化202611108.md)
- 製品バージョン: v0.3.10 以降に同梱
- 置き場: core（`packages/opencode`）+ builtin evolve skill + 本ドキュメント

## 何が進化したか

「機構は揃っているがループが閉じていない」状態を、**証拠照合・スコープ表示・autonomy 証拠・読取効率・運用手順**の5本柱で閉じた。

| ID | 変更 | 主なファイル |
|---|---|---|
| **HEB-01 / R-07** | brief の `Status:` を正本とし、INDEX は導出可能。`evolve_status` の open 件数は**ファイル数ではなく Status** | `evolve/brief-status.ts`, `evolve/index-derive.ts`, `evolve/store.ts`, `tool/evolve.ts` |
| **HEB-03 / R-03** | project 配下が空なら **`global` フォールバック**し、`source` と `global_counts` を表示 | `evolve/evolve-scope.ts`, `evolve/store.ts` |
| **HEB-02 / R-08** | `judge_complete` 時に **evidence manifest** を永続化、`failure_class` 記録、**予算カウンタ執行**の入口 | `autonomy/run.ts`, `autonomy/evidence.ts` |
| **HEB-04 / R-01** | 同一内容の再読を **内容 fingerprint** で短縮（`read` の `force` で全文取得可） | `tool/read-policy.ts`, `tool/read.ts` |
| **Phase 5** | evolve SKILL / プロンプト / brief テンプレに **Owner・Verification・窓ラベル・backlog 衛生** | `skill/builtin/.../evolve/`, `agent/prompt/evolve.txt` |

### ユーザー向け挙動の変化

1. **`evolve_status`（dashboard）** — `Briefs open` が実際の未完了 brief に近づく。`source: global` のときは「改善なし」ではなく global 在庫を参照していることが明示される。
2. **Autonomy（SE/FDE）** — run 完了時に DB 上で manifest が残り、後から「何が検証されたか」を追える。
3. **Read ツール** — 変更のないファイルの二度読みでトークン消費が減る。
4. **Evolve 運用** — 新規 brief は Owner/検証コマンド必須、BACKLOG の陳腐化エントリ整理手順がスキルに載った。

## 見込めるメリット

| 観点 | 効果 |
|---|---|
| **時間** | INDEX/brief 乖離による再調査（10〜30 分/回級）の削減、無駄な同一ファイル再読の削減 |
| **信頼** | ダッシュボードと brief 本文の一致、autonomy run の完了根拠が DB に残る |
| **マルチプロジェクト** | `~/.oimo/evolve/global/` の在庫を project ダッシュボードから見える化 |
| **コスト** | モデル入力削減（読取 dedup）、長セッションのテスト試行予算の抑制入口 |
| **引き渡し** | 外部エージェント向け brief テンプレの標準化（agent-skills へ export 同期可） |

優先投資は報告書どおり **新機能の追加ではなく L5/L7（検証とループ閉鎖）** である点は変わらない。本リリースはその第一弾である。

## 検証コマンド

リポジトリルート:

```bash
bun script/verify-evolution-doc.ts   # 自己進化202611108.md D1–D10
```

`packages/opencode` 配下:

```bash
bun test test/evolve/brief-status.test.ts
bun test test/evolve/scope.test.ts
bun test test/evolve/soft-evolution-guidance.test.ts
bun test test/autonomy/evidence-manifest-run.test.ts
bun test test/tool/read-policy.test.ts
bun typecheck
```

## 意図的に今回含めないもの

- 新規 EVB（5 本目）の追加 — 既存 4 brief の**照合優先**
- `~/.oimo/evolve/global/INDEX.md` の自動書き換え — 生成ロジックは導入済み、運用で derive する想定（破壊的一括更新は手動）
- `.oimo/skills/` のプロジェクトローカル skill — 製品コミット外

## 関連コミット（main）

- `f8c38e666e` — core: brief status, scope, manifest, read dedup, 報告書・ドクリント
- `e598ce6f91` — Phase 5 ガイダンス + テスト

リリース手順: [`docs/RELEASING.md`](../RELEASING.md)

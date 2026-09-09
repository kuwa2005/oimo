# Spec: リリース v0.1.14 カット (docs ビューア込み)

- Status: Draft
- Date: 2026-08-06
- Author: compose agent (SE mode)
- Type: operational spec

## 背景

ユーザー指示「コミットし、リリースを更新して」— docs ビューア作業 (前タスク、未コミット) を
コミット・プッシュし、新しいリリースをカットする。リリースパイプライン (publish.yml / script/release)
は本タスクで初めて実運用される。

## ヒアリングログ

### H1 (2026-08-06) — バージョン番号
- なぜ聞いたか: package.json は 0.1.10 のまま (過去リリースは MIMOCODE_VERSION 上書きでカット) で、
  自動 bump (patch) だと v0.1.11 が算出され、**既存の remote タグ v0.1.11 と衝突して
  ワークフローが失敗する**。明示指定が必須。
- 背景: remote タグ v0.1.10–v0.1.13 が存在 (確認済み)。
- 結果: **v0.1.14** を `script/release --version 0.1.14` で明示指定。

### H2 (2026-08-06) — npm publish / FDS の扱い
- なぜ聞いたか: リポジトリにシークレットが 0 件 (NPM_TOKEN / MIMO_FDS_AK / MIMO_FDS_SK 未設定)。
  npm パッケージ (opencode/sdk/plugin) と FDS ミラーは公開されない。
- 背景: トークンはユーザー所有 — エージェントからは設定不可。NPM_TOKEN 不在時は publish ジョブが
  warning 付きで npm をスキップする設計 (TASK 6 R4)。
- 結果: **スキップで進める**。GitHub リリース + アセット + SHA256SUMS + 公開 (draft=false) は完了。
  npm/FDS は後に `gh secret set` で追加すれば次回から有効。

### H3 (2026-08-06) — 実行方式
- なぜ聞いたか: ヘッドレス環境で CI を完了まで監視する必要がある。
- 結果: **script/release フル実行** (preflight → dispatch → `gh run watch` → summary)。失敗時は
  `gh run view --log-failed` で原因取得 → 修正 → 再実行。

### H4 (2026-08-06) — コミット粒度
- 結果: **1 コミット** (docs ビューア実装一式: 生成スクリプト / vendored marked / テスト /
  pages.yml / AGENTS.md / spec / report / 生成物 docs/index.html)。

### H5 (2026-08-06) — Requirements Lock
- [Never-Ask] (ヘッドレス) — 推奨案を Approved として扱い実行へ進む。

## 手順 (Requirements)

- **R1 コミット**: docs ビューア作業を 1 コミットで作成し、origin/main へプッシュ (husky pre-push の
  ため bun を PATH に含めて実行)。
- **R2 リリース**: `script/release --version 0.1.14` で preflight → dispatch → watch まで自動実行。
  GH_REPO 既定 `kuwa2005/oimo`。
- **R3 検証**: 完了後、以下を gh で確認。
  - workflow run が成功 (version → build-cli matrix 12 → publish)。
  - release v0.1.14 が存在し、12 アセット + SHA256SUMS を含み draft でない。
  - main にバージョン bump コミット (chore: bump version to 0.1.14) とタグ v0.1.14 が存在。
  - npm publish / FDS がスキップ警告を出していること。
- **R4 失敗時**: ログ取得 → 修正 (workflow または script) → 再実行。部分成功 (例: version ジョブ成功
  後に失敗) の場合は既存タグ/リリースの状態を確認してから再実行。
- **R5 レポート**: docs/compose/reports/release-0.1.14.md に結果 (バージョン / アセット一覧 /
  テスト結果 / npm・FDS スキップの理由 / 知見) を記録。

## テスト仕様 (Test Specification)

| ID | 内容 | 判定 |
|---|---|---|
| T1 | コミット+プッシュ後、作業ツリーがクリーン | git status 空 |
| T2 | `script/release --version 0.1.14` が preflight を通過 (gh 認証 OK、シークレット警告のみ) | 失敗せず dispatch に進む |
| T3 | workflow run が成功する (3 ジョブ) | `gh run view` で success |
| T4 | release v0.1.14 にアセット 12 件 + SHA256SUMS、draft でない | `gh release view v0.1.14` |
| T5 | タグ v0.1.14 + bump コミットが main に存在 | git ls-remote / log |
| T6 | npm publish / FDS スキップ警告がログに出力 | `gh run view --log` |
| T7 | docs ビューア作業がリリースに含まれる (HEAD が bump コミット) | リリースの --target sha 確認 |

# Report: GitHub Releases パイプライン追加 + インストーラー更新 (テスト結果)

Date: 2026-08-06
Author: compose agent (SE mode)
Spec: [docs/compose/specs/releases-installer.md](../specs/releases-installer.md) (Status: Approved)

## 概要

「releasesを追加、インストーラーを更新」に対し、以下を実装・検証した:

1. **publish.yml ワークフロー新設** — `workflow_dispatch` のみ (bump major/minor/patch + version 上書き)。jobs: `version` (バージョン算出 + 全 package.json bump + commit/push + ドラフトリリース作成) → `build-cli` (全 12 ターゲットビルド + SHA256SUMS + gh/FDS アップロード) → `publish` (npm publish + リリース finalize)。NPM_TOKEN 不在時は npm をスキップして警告 (repo シークレット空のため必須)。
2. **バージョン整合性回復** — `script/bump-version.ts` (純関数 `bumpVersions`) を新設し、version.ts がリリース作成**前**に bump + commit + push するように変更。publish.ts のインライン書き換えもヘルパー共用に置換。git バージョン (0.1.10) とタグ (v0.1.13) の乖離の根因を解消。
3. **SHA256 チェックサム検証** — `script/checksums.ts` (純関数 `sha256Sums`、sha256sum -c 互換 `"<hex>  <name>"`、ソート) を新設。build.ts のリリースパスで `SHA256SUMS` を生成し gh/FDS アップロードに含める。
4. **インストーラー更新** — `install` (bash) / `install-utf8.ps1` に `OIMO_BASE_URL` 対応 + `verify_checksum` (不一致 = exit 1、404/エントリ無し = 警告+継続、macOS `shasum -a 256` フォールバック)。install.ps1 を再生成。
5. **changelog.ts 修正** — 存在しない `opencode run --command changelog` を廃止し、git log (`--from` 既定 = 最新タグ) + 純関数 `renderChangelog` (conventional-commit グループ化) に置換。
6. **setup-bun 修正** — `bun install` → `bun ci` (AGENTS ルール整合)。

## テスト結果

実行コマンド: `bun test --timeout 30000 test/cli/release-installer.test.ts` (workdir = packages/opencode)

| ID | 内容 | 結果 |
|----|------|------|
| T1 | `sha256Sums` 単体 (`"<hex>  <name>"`・ソート・ハッシュ一致) | **PASS** |
| T1b | `bumpVersions` 単体 (node_modules/dist 除外・一括書換) | **PASS** |
| T2 | インストーラー E2E 正常系 (偽リリースサーバ + OIMO_BASE_URL + チェックサム一致) | **PASS** |
| T3 | インストーラー E2E 改竄 (チェックサム不一致 → exit 1、インストール中断) | **PASS** |
| T4 | インストーラー E2E SHA256SUMS 不在 (警告 + 継続、後方互換) | **PASS** |
| T5 | publish.yml 静的検証 (dispatch / bump choice / env / jobs / npm skip) | **PASS** |
| T6 | install.ps1 再生成決定性 (byte-for-byte + Get-FileHash/OIMO_BASE_URL/SHA256SUMS 含有) | **PASS** |
| T7 | `renderChangelog` 単体 (グループ化 / プレフィックス除去 / 空入力) | **PASS** |

**10 pass / 0 fail (46 expect calls)**

## その他の検証

| 項目 | コマンド | 結果 |
|------|----------|------|
| 型検査 | `bun typecheck` (packages/opencode) | **PASS** |
| 回帰 | `bun test --timeout 30000 test/cli/` (53 ファイル) | **351 pass / 4 fail** — 4 件は全て既知の `voice > processVoiceControl` ネットワークタイムアウト (環境要因、`test/cli/tui/voice.test.ts` 単独実行で 33/4 を確認、本変更と無関係) |
| checksums スモーク | `bun script/checksums.ts /tmp/chk_a.txt /tmp/chk_b.txt` | 出力が `sha256sum` とバイト一致・ファイル名ソート順 |
| changelog スモーク | `bun script/changelog.ts --from v0.1.11 --to v0.1.13 --print` | グループ化 (Features/Fixes/Other) を確認。タグ後コミット無しレンジ (v0.1.13..HEAD) は "No notable changes" (正しい) |
| install.ps1 同期 | `bun script/build-install-ps1.ts` + T6 | 再生成 = コミット済み install.ps1 とバイト一致 |

## 変更ファイル

**新規**
- `.github/workflows/publish.yml`
- `script/checksums.ts`
- `script/bump-version.ts`
- `packages/opencode/test/cli/release-installer.test.ts`
- `docs/compose/specs/releases-installer.md` (本タスクの spec)

**変更**
- `script/version.ts` — bump + commit + push → sha 再取得 → changelog → `gh release create -d --target`
- `script/publish.ts` — インライン version 書換を `bumpVersions` に置換
- `script/changelog.ts` — 全面書き換え (git log + renderChangelog)
- `packages/opencode/script/build.ts` — リリースパスで SHA256SUMS 生成・アップロード + FDS コメント修正 (OIMO_BASE_URL 言及)
- `install` / `install-utf8.ps1` / `install.ps1` — OIMO_BASE_URL + チェックサム検証
- `.github/actions/setup-bun/action.yml` — `bun install` → `bun ci`

## リリース実行手順 (ユーザー手動、不可逆操作のため自動カットはしない)

1. repo シークレット追加 (Settings → Secrets and variables → Actions):
   - `NPM_TOKEN` (npmjs.com access token、publish 権限) — 未設定時は npm がスキップされる
   - `MIMO_FDS_AK` / `MIMO_FDS_SK` (および任意で `MIMO_FDS_ENDPOINT` / `MIMO_FDS_BUCKET` / `MIMO_FDS_PREFIX`) — 未設定時は FDS ミラーがスキップされる
2. リリースカット: `GH_REPO=kuwa2005/oimo ./script/release patch` (または major / minor)。バージョン固定は publish.yml の `version` input で上書き可能。
3. ワークフローが バージョン bump → ビルド (12 ターゲット) → アセット+SHA256SUMS アップロード → npm publish → リリース finalize を実行。

## 知見

- `script/release` は既に `gh workflow run publish.yml` を発火する設計 — publish.yml 追加でそのまま有効化された。
- npm は per-platform パッケージ (`@mimo-ai/oimo-<platform>-<arch>`) で配布されており、GitHub リリースアセットは curl/irm インストーラー専用。SHA256SUMS もインストーラー検証専用。
- インストーラーの検証は「404/エントリ無し = 警告+継続」で後方互換 (v0.1.10–13 には SHA256SUMS 無し)。
- publish.yml の version job は checkout が detached HEAD になるため、push は `git push origin HEAD:<branch>` (GITHUB_REF_NAME フォールバック) で明示している。
- テスト T2–T4 は `OIMO_BASE_URL` を偽リリースサーバ (Bun.serve) に向けることで、GitHub に触れずにインストール→検証→失敗系を E2E 検証できる。

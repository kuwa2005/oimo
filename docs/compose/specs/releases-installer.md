# Spec: GitHub Releases パイプライン追加 + インストーラー更新

Status: Approved
Date: 2026-08-06
Author: compose agent (SE mode)

## Background

ユーザー依頼: 「releasesを追加、インストーラーを更新」。

現状調査の結果:
1. リリース機構スクリプト群は存在 (`script/release`, `script/release.ts`, `script/version.ts`, `script/publish.ts`, `packages/opencode/script/build.ts`, `fds-upload.ts`)。
2. しかし `script/release` が `gh workflow run publish.yml` を呼ぶ — **`.github/workflows/publish.yml` がフォークに存在しない** (上流 anomalyco 由来は git 履歴にあるが削除されている)。GitHub Releases は手動カットされ、**v0.1.13 のアセットは linux-x64 の 3 種のみ** (darwin/windows/arm64 が欠落 → macOS/Windows/ARM のインストーラーは 404)。
3. **バージョン bump がコミットされていない**: package.json は 0.1.10 のまま v0.1.10–v0.1.13 が切られている (`script/publish.ts` は package.json を書き換えるがコミットしない)。`./script/release patch` は 0.1.11 (既存) を再カットしてしまう。
4. **changelog.ts が壊れている**: `opencode run --command changelog` を呼ぶが、フォークの CLI は `oimo` で同コマンドは存在しない → リリースノートは常に "No notable changes" になる (version.ts の nothrow フォールバックで握りつぶされている)。
5. **インストーラーにチェックサム検証なし**。FDS (Xiaomi CDN) は `fds-upload.ts` がアップロード実装を持つ一方、`build.ts` のコメントは「install は FDS から読む」と言うが **install に FDS ロジックが存在しない** (陳腐化コメント)。
6. リポジトリシークレットは未設定 (`gh secret list` 空) — npm 公開 (NPM_TOKEN) と FDS アップロード (MIMO_FDS_AK/SK) はシークレット設定後に有効化されるべき。

## ヒアリングログ

| # | 質問 | 背景 | 結果 |
|---|------|------|------|
| H1 | 「releasesを追加」のスコープは? | publish.yml が無く、現行リリースは linux-x64 のみ | **A: publish.yml をフォーク用に新規追加** (workflow_dispatch で bump 指定 → version/bump + 全 12 ターゲットのバイナリを GitHub Releases へ + npm + FDS)。自動リリースカットは不可逆な公開操作のため実施せず、`./script/release patch` をユーザーの 1 コマンドステップとして文書化 |
| H2 | インストーラー更新の内容 | チェックサムなし / FDS 未実装 (コメントと実装の不一致) | **SHA256 チェックサム検証 + ダウンロードベース URL オーバーライド (`OIMO_BASE_URL`)** を追加。FDS CDN ホストはコード内に存在せず URL 推定はしない — オーバーライドが FDS/テスト両方の経路を提供 |
| H3 | publish.yml のトリガー・公開範囲 | script/release は `gh workflow run publish.yml -f bump=` を想定 | **workflow_dispatch のみ** (bump: major/minor/patch + version 上書き)。npm 公開と FDS (シークレット設定時) を含む。dev ブランチ自動プレビューは対象外 |
| H4 | 自動リリース実行 | gh は所有者 kuwa2005 として認証済み (repo+workflow) | **実行しない** — npm 公開・公開リリースは不可逆。シークレット未設定のため現状では失敗する。ユーザー実行用に手順を文書化 |
| H5 | シークレット不在 | NPM_TOKEN / MIMO_FDS_AK/SK 未設定 | ワークフローは NPM_TOKEN 不在時 npm ステップを**警告付きでスキップ** (リリースアセットは GitHub に完了する)。FDS は build.ts 既存どおり認証情報なしでスキップ |
| H6 | バージョン bump 未コミット | package.json 0.1.10 のまま v0.1.13 までリリース | version.ts に **bump コミット + push を追加** (リリース作成前に実行)。`./script/release patch` が正しい次バージョンを切れるようにする |
| H7 | changelog.ts の opencode 依存 | フォークに opencode コマンドなし | **git-log ベースのノート生成に置換** (純関数 render + 単体テスト対象) |
| H8 | Windows インストーラーのテスト | 環境に pwsh なし | install.ps1 は**静的検証のみ** (生成の決定性 + チェックサムロジックのマーカー確認)。bash install は E2E テスト (偽リリースサーバー) |
| H9 | FDS の範囲 | CDN ホスト不明、レイアウトは fds-upload.ts が GitHub と非互換 (`releases/` vs `releases/download/`) | FDS は**アップロード側のみ既存維持**。インストーラー側は汎用 `OIMO_BASE_URL` オーバーライドで対応 (FDS は GitHub 互換レイアウトを配信するホストをユーザーが指定可能) |

## Goals / Non-goals

### Goals
- `script/release` が動く publish.yml を追加し、全プラットフォームのリリースを CI で切れるようにする。
- インストーラーがダウンロードの完全性を検証できるようにする (SHA256)。
- インストーラーのダウンロード元をオーバーライド可能にする (`OIMO_BASE_URL` — テスト + ミラー用)。
- リリースのバージョン整合性を回復する (bump コミット、リリースノート生成)。

### Non-goals
- Electron/デスクトップアプリ、コード署名 (Windows/macOS)、AUR、Docker イメージ、beta チャンネルのプレビューリリース。
- FDS アップロード側の変更 (既存実装を維持)。FDS CDN ホストの推定・実 URL の組み込み。
- `oimo upgrade` TUI コマンド。
- 自動リリースカット (本セッションでは実行しない)。

## Requirements

### R1: `.github/workflows/publish.yml` (新規)
- `workflow_dispatch` のみ。inputs: `bump` (choice: major/minor/patch、任意)、`version` (上書き、任意)。
- `permissions: contents: write`。`runs-on: ubuntu-latest`。`concurrency` ガード。
- ジョブ:
  - **version**: checkout (fetch-depth 0, fetch-tags) → setup-bun → `bun script/version.ts` (env: MIMOCODE_BUMP, MIMOCODE_VERSION, GH_REPO, GH_TOKEN)。outputs: version / release / tag / repo。
  - **build-cli** (needs version): checkout (fetch-tags) → setup-bun → `bun ./packages/opencode/script/build.ts` (env: MIMOCODE_VERSION, MIMOCODE_RELEASE, GH_REPO, GH_TOKEN, MIMO_FDS_AK/SK — あれば FDS にもアップロード)。
  - **publish** (needs version, build-cli): checkout → setup-bun → setup-node (registry npmjs) → `./script/publish.ts` (env: MIMOCODE_VERSION, MIMOCODE_RELEASE, GH_REPO, GH_TOKEN, NPM_TOKEN)。**NPM_TOKEN 不在時は npm 公開をスキップして警告ログを出す** (GitHub リリースは完了しているため失敗扱いにしない)。
- 上流 (anomalyco) 由来の electron / 署名 / AUR / docker ジョブは含めない。

### R2: `.github/actions/setup-bun/action.yml`
- `bun install` → `bun ci` に変更 (AGENTS.md の frozen-lockfile ルールに整合)。

### R3: `script/version.ts` (バージョン整合性の回復)
- 非プレビュー時、リリース作成**前**に:
  1. `bumpVersions(Script.version)` (R4) で全 package.json の version を更新
  2. `git add` 対象ファイル → `git commit -m "chore: bump version to ${Script.version}"` → `git push` (現在ブランチ)
  3. changelog 生成 → `gh release create vX -d --target <push 後の HEAD sha>` (sha はコミット後に再取得)
- プレビュー時は変更なし (現状維持)。

### R4: `script/bump-version.ts` (新規)
- 純関数 `bumpVersions(version: string): string[]` — リポジトリ内の全 package.json (node_modules/dist 除外) の `"version"` を一括書き換え。変更ファイル一覧を返す。
- `script/publish.ts` のインライン書き換えロジックをこのヘルパーに置換。

### R5: `script/checksums.ts` (新規)
- 純関数 `sha256Sums(files: string[]): Promise<string>` — 各ファイルの SHA256 を `"<hex>  <basename>"` 形式 (sha256sum -c 互換) で連結。ファイル名でソート。
- CLI: `bun script/checksums.ts <file...>` → stdout に出力。

### R6: `packages/opencode/script/build.ts` (リリースパス)
- `Script.release` 時、archives 生成後に `SHA256SUMS` を dist/ に生成 (R5 使用)。
- `gh release upload` と FDS アップロードに `SHA256SUMS` を含める。
- 陳腐化コメント修正: 「install は FDS から読む」→ 「install は `OIMO_BASE_URL` でダウンロード元をオーバーライドできる」に変更。

### R7: `script/changelog.ts` (git-log ベース)
- `opencode run` 呼び出しを廃止し、`git log --oneline <from>..<to>` からリリースノートを生成。
- `--from` 既定 = 最新の git タグ (`git describe --tags --abbrev=0`)、`--to` 既定 = HEAD。
- 純関数 `renderChangelog(lines: string[]): string` を export (単体テスト対象)。コミット種別 (feat/fix/perf/refactor/docs/chore/その他) でグループ化した Markdown。
- `--variant` は削除。`--print` / `--quiet` は維持。

### R8: `install` (bash インストーラー)
- 環境変数 `OIMO_BASE_URL` (既定 `https://github.com/$repo`) — ダウンロード URL と SHA256SUMS 取得 URL の基底を置換。
- ダウンロード後: 同一リリースの `SHA256SUMS` を取得。
  - 取得成功 → 該当ファイルのハッシュと突合。不一致は**エラーで中断** (exit 1)。
  - 404 (チェックサム不在) → **警告を表示して続行** (既存リリース v0.1.10–13 は SHA256SUMS を持たないため後方互換)。
- usage に `OIMO_BASE_URL` の説明を 1 行追加。

### R9: `install-utf8.ps1` / `install.ps1`
- bash と同セマンティクス: `$env:OIMO_BASE_URL` で基底置換、`Get-FileHash -Algorithm SHA256` で検証。SHA256SUMS 不在時は警告して続行。
- `script/build-install-ps1.ts` で `install.ps1` を再生成。

### R10: 実行手順の文書化
- `docs/compose/reports/releases-installer-test.md` に 1 コマンド実行手順を記載:
  `GH_REPO=kuwa2005/oimo ./script/release patch` (または `gh workflow run publish.yml -f bump=patch`)。
- npm/FDS を有効化するにはリポジトリシークレット `NPM_TOKEN` / `MIMO_FDS_AK` / `MIMO_FDS_SK` を設定する必要がある旨を明記。

## テスト仕様

新規テストファイル: `packages/opencode/test/cli/release-installer.test.ts`。

| # | テスト | 内容 |
|---|--------|------|
| T1 | checksums 単体 (unit) | `sha256Sums` — 形式 (`hash  name`、2 スペース)、正しいハッシュ値、複数ファイル、ソート順 |
| T2 | install 正常系 (E2E) | Bun.serve で偽 GitHub リリース (tar.gz + SHA256SUMS) を配信。`OIMO_BASE_URL=<local>` + `--version 0.0.0-test` + `--no-modify-path` + HOME=tmp で実行 → exit 0、`$HOME/.oimo/bin/oimo` が存在 |
| T3 | install 改ざん検知 (E2E) | 偽 SHA256SUMS に対して破損 tar.gz → チェックサム不一致エラー、exit 非 0 |
| T4 | install SHA256SUMS 不在 (E2E) | SHA256SUMS を配信しない → 警告 + インストール成功 (後方互換) |
| T5 | publish.yml 静的 (static) | マーカー検証: `workflow_dispatch`、bump choice、`MIMOCODE_BUMP`/`MIMOCODE_VERSION`/`MIMOCODE_RELEASE`/`GH_REPO`、build.ts 呼び出し、publish.ts 呼び出し、NPM_TOKEN スキップ分岐 |
| T6 | install.ps1 回帰 (static) | `script/build-install-ps1.ts` 再生成後 `git diff` なし (決定性) + チェックサムロジックのマーカー (`Get-FileHash`, `OIMO_BASE_URL`) を含む |
| T7 | changelog 単体 (unit) | `renderChangelog` — 種別グループ化、空入力、その他カテゴリ |
| T8 | 回帰 | `bun typecheck` + `bun test test/cli/` (既知の voice 4 件の失敗は環境要因として許容) |

テスト実行時の注意:
- T2–T4 は子プロセス spawn のため `bun test --timeout 30000` で実行 (package.json の test スクリプト既定)。
- 偽サーバーは `Bun.serve` + 一時ディレクトリ (tmpdir fixture 使用可)。

## Open questions
- (なし — ヒアリングで確定。H1–H9 参照)

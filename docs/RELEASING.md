# リリース手順 (RELEASING)

このドキュメントは oimo のリリースを「迷わず」進めるためのランブックです。
リリースカットは原則 **`./script/release` の 1 コマンド** で完結します (bump → タグ push → 自動リリース)。
詳細な仕組みを知りたい場合やトラブル時は、このドキュメントの該当セクションを参照してください。

## 概要

リリース制御は GitHub Actions へ移譲されています。**`v*` 形式のタグを push すると**
ワークフロー (`.github/workflows/release.yml`) が自動でビルド・公開します。

```
[タグ push: v0.1.15]
   ↓ (on: push.tags.v*)
build-cli (12 ターゲットを build matrix で並列ビルド → アーカイブのみ生成)
   ↓ (needs)
assemble (アーカイブ集約 → SHA256SUMS 生成 → リリースノート → softprops でリリース作成・公開)
```

- **トリガー**: `v*` タグの push のみ。`workflow_dispatch` (手動発火) は廃止されました。
- **公開まで自動**: タグ push 後はビルド・アセット・チェックサム・リリース公開まで CI が自動実行します。
  人間が操作するのはタグを作って push する (次の手順) だけです。
- **配布**: GitHub Releases のみ（上流 `@mimo-ai/*` npm とは無関係）。
- バージョンの真実は**タグ名**です (`v0.1.15` → `MIMOCODE_VERSION=0.1.15`)。ワークフロー内での
  bump コミットは行いません。

## 前提条件

リリースに必要な環境とシークレット。

1. **gh CLI がインストール・認証済み** (`gh auth status` で確認)。必要なスコープ: `repo` と `workflow`。
2. **リポジトリシークレット** (リポジトリ Settings → Secrets and variables → Actions):

   | シークレット | 必須 | 省略時の挙動 |
   |---|---|---|
   | `MIMO_FDS_AK` / `MIMO_FDS_SK` | 任意 | FDS (中国向け CDN ミラー) へのアップロードをスキップ |
   | `MIMO_FDS_ENDPOINT` / `MIMO_FDS_BUCKET` / `MIMO_FDS_PREFIX` | 任意 | FDS の接続先 (既定値がある場合は不要) |

   この fork は **GitHub Releases のみ**で配布します。上流 `@mimo-ai/*` への npm 公開は行いません（`NPM_TOKEN` は不要）。

   `gh secret list` で確認できます。`script/release` がプリフライトで設定状況を表示します。

3. **作業ツリー**: 未コミットの変更があると警告が出ます。リリースの bump コミットには
   **package.json のみ**が含まれるので、他の変更は先にコミットしておいてください。

## リリース手順

```bash
# patch リリース (既定)
./script/release

# 明示的に bump 種別を指定
./script/release minor

# バージョンを直接指定 (bump 計算をスキップ)
./script/release --version 0.1.15

# タグ push のみで監視しない (バックグラウンドで回す場合)
./script/release --no-watch
```

`script/release` が行うこと:

1. **プリフライト** — gh の存在・認証、未コミット変更の警告、シークレット設定状況の表示。
2. **bump & コミット** — `script/bump.ts` がバージョンを決定し、全 package.json を書き換えて
   `chore: bump version to <version>` でコミット。
3. **ブランチ push** — bump コミットを `origin/<現在ブランチ>` へ push。
4. **タグ push** — `v<version>` タグを作成して push。これがリリースのトリガーです。
5. **監視** — `gh run watch` で release.yml の完了まで待機 (途中で Ctrl-C してもワークフローは継続)。
6. **結果表示** — ジョブ別の結果とリリースページの URL。

タグを push した時点でリリースは「作られる運命」です。ワークフローが失敗した場合は
`gh run view <id> --log-failed` でログを確認し、修正後に**バージョンを上げて**再実行してください。

### 手動でタグを push する場合

`script/release` を使わずに `git tag v0.1.15 && git push origin v0.1.15` でも release.yml は発火します
(バージョンはタグ名から取られます)。ただし package.json の bump コミットは入らないため、
**`script/release` を使うのが推奨**です (バージョン整合性が保たれます)。

### バージョン決定規則

- `--version X.Y.Z` を指定 → そのバージョンをそのまま使用。
- bump 種別 (`major`/`minor`/`patch`) → `packages/opencode/package.json` の現在バージョンから
  `script/bump.ts` (`nextVersion`) が 1 段上げ、`script/bump-version.ts` (`bumpVersions`) が
  **全 package.json を一括書き換え** (`node_modules` / `dist` は除外)。
- 指定がない場合は `patch` が既定。

## ワークフロー各ジョブの動作

### build-cli (build matrix)

- 12 ターゲット (`linux-arm64`, `linux-x64`, `linux-x64-baseline`, `linux-arm64-musl`,
  `linux-x64-musl`, `linux-x64-baseline-musl`, `darwin-arm64`, `darwin-x64`,
  `darwin-x64-baseline`, `windows-arm64`, `windows-x64`, `windows-x64-baseline`) を
  **並列ジョブ**でビルド。逐次ビルド時代に比べウォールクロックが大幅に短縮されます。
- 各ジョブは `MIMOCODE_TARGETS=<target>` で自分のターゲットだけをビルドします。
  `MIMOCODE_RELEASE=1` でアーカイブ (`oimo-<os>-<arch>[-baseline][-musl].{tar.gz|zip}`) を生成し、
  `MIMOCODE_SKIP_UPLOAD=1` で **gh release へのアップロードを抑止**します
  (この時点ではリリースが未作成のため)。アーカイブは `actions/upload-artifact` で assemble へ渡します。
- FDS シークレットがあれば各ジョブが自分のアセットを FDS ミラーへもアップロードします
  (SKIP_UPLOAD の影響を受けません)。
- `packages/opencode/script/targets.ts` がターゲット定義・名前計算を一元管理します
  (`MIMOCODE_TARGETS` 未指定なら従来どおり全ターゲットを 1 プロセスでビルド — ローカルリリースビルド互換)。

### assemble

1. `actions/download-artifact` で全アーカイブを `release-assets/` に集約。
2. `script/checksums.ts` で **SHA256SUMS を集約生成** (`sha256sum -c` 互換)。matrix で分散ビルドしても
   チェックサムは単一の正にまとまります。
3. `script/changelog.ts` でリリースノートを生成 (git log、conventional commit グループ化。
   範囲は直前の `v*` タグから HEAD)。
4. **softprops/action-gh-release** でリリースを作成・公開 (`draft: false`)。
   12 アーカイブ + `SHA256SUMS` を添付します。アセットが欠けている場合は失敗します
   (`fail_on_unmatched_files: true`)。
5. npm 公開は行いません（この fork は GitHub Releases のみ）。

## アセットとチェックサム・インストーラー検証

- リリースには 12 アーカイブ + `SHA256SUMS` が含まれます。形式は `sha256sum -c` 互換
  (`<hex>  <name>`、名前順ソート)。
- インストーラー (`install` / `install.ps1`) は `SHA256SUMS` をダウンロードして検証します:
  - 不一致 → インストール中止 (exit 1)。
  - `SHA256SUMS` が無い / エントリが無い (旧リリース) → 警告のみで継続 (後方互換)。
- `OIMO_BASE_URL` 環境変数でダウンロード・チェックサム取得のベース URL を差し替えられます
  (既定は `https://github.com/<repo>`。FDS ミラー運用やテストで使用)。

## 配布経路

公式インストールは **curl / irm インストーラー → GitHub Releases アセット** のみです。
上流の `@mimo-ai/cli` npm パッケージとは無関係です。

## FDS ミラー (任意)

中国向け CDN ミラー。`MIMO_FDS_AK` / `MIMO_FDS_SK` (と必要に応じて ENDPOINT/BUCKET/PREFIX) を設定すると、
各 build-cli ジョブがアセットを FDS へもアップロードします。シークレット未設定時は自動スキップです。

## トラブルシュート

| 症状 | 原因と対処 |
|---|---|
| `Error: not authenticated with gh` | `gh auth login` を実行 (スコープ: repo, workflow)。 |
| `checksum mismatch` でインストール失敗 | ダウンロードが壊れているか、リリースの SHA256SUMS と実アセットが不一致。リリースページで SHA256SUMS を再確認し、壊れたリリースは `gh release delete` + バージョンを上げて再実行。 |
| リリースノートが「No notable changes」になる | 直前タグからの差分が無いか、タグがローカルに無い。`git fetch --tags` してから再実行。 |
| タグ push してもワークフローが走らない | release.yml がデフォルトブランチに存在し、**登録済み**であること (`gh api repos/<owner>/<repo>/actions/workflows` で確認)。このリポジトリでは登録拒否がサイレントに起きた実績があるため、ワークフロー変更時は必ず確認する。 |
| build-cli の一部ジョブだけ失敗 | matrix は `fail-fast: false` なので他ターゲットは継続。失敗ジョブのログ (`gh run view <id> --log-failed`) を確認し、修正後に**バージョンを上げて**再実行 (同じタグを再 push するには先にタグとリリースを削除する必要があります)。 |
| `Unknown argument` が出る | `script/release --help` で使い方を確認。 |

## 開発・デバッグ用コマンド

```bash
# 特定ターゲットだけローカルビルド (アップロードなし)
MIMOCODE_TARGETS=linux-x64 bun packages/opencode/script/build.ts

# リリースビルドのアーカイブのみ生成 (gh release へアップロードしない)
MIMOCODE_RELEASE=1 MIMOCODE_SKIP_UPLOAD=1 MIMOCODE_TARGETS=linux-x64 bun packages/opencode/script/build.ts

# バージョン bump のみ (コミット付き、新バージョンを表示)
bun script/bump.ts patch

# チェックサム生成のみ
bun script/checksums.ts <file...>

# リリースノート生成 (タグ範囲)
bun script/changelog.ts --from v0.1.14 --to v0.1.15 --print

# install.ps1 再生成 (決定性)
bun script/build-install-ps1.ts
```

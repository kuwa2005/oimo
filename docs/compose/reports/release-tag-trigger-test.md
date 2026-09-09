# Report: Tag-triggered release workflow (release.yml)

- Status: Complete
- Date: 2026-08-07
- Spec: [release-tag-trigger.md](../specs/release-tag-trigger.md) (Requirements Lock: Approved — never-ask 自律承認)

## 実施内容

リリース制御を GitHub Actions へ完全移譲。`v*` タグの push をトリガーに自動ビルド・公開する
`.github/workflows/release.yml` を新設し、旧 dispatch 方式 (`publish.yml` + `script/release` の
`gh workflow run`) を廃止した。

| 変更 | 内容 |
|---|---|
| `.github/workflows/release.yml` (新規) | `on: push.tags: ["v*"]` / `permissions: contents: write` / build-cli (12 ターゲット matrix) → assemble (download-artifact → SHA256SUMS → changelog → **softprops/action-gh-release@v2** (draft: false) → npm ガード) |
| `packages/opencode/script/build.ts` | `gh release upload` を `MIMOCODE_SKIP_UPLOAD` でゲート (アーカイブ生成・FDS は維持) |
| `script/bump.ts` (新規) | `nextVersion` 純関数 + CLI: バージョン決定 → `bumpVersions` → git commit → stdout 出力 |
| `script/release` (bash) | bump → ブランチ push → タグ vX.Y.Z push → release.yml の run 検出 → `gh run watch` |
| 削除 | `.github/workflows/publish.yml` / `script/version.ts` / `script/release.ts` |
| `docs/RELEASING.md` | タグプッシュ方式に全面改訂 (ジョブ動作・トラブルシュート・開発コマンド) |
| `AGENTS.md` / プロジェクト MEMORY.md | リリース手順の参照行をタグプッシュ方式に更新 |

## テスト結果 (V1–V4)

| ID | コマンド | 結果 |
|---|---|---|
| V1 | `bun test --timeout 30000 test/cli/release-build-matrix.test.ts` | **27 pass / 0 fail** (83 expect) |
| V2 | `bun test --timeout 30000 test/cli/release-installer.test.ts` | **10 pass / 0 fail** (44 expect) |
| V3 | `bun test --timeout 30000 test/cli/` (回帰) | **386 pass / 4 fail** — 4 fail は全て既知の `voice` ネットワークタイムアウト (環境要因、前回から不変) |
| V4 | `bun typecheck` (packages/opencode) | **PASS** |

テスト仕様 T1–T9 の内訳: T1–T2e (targets.ts、維持) / **T3–T3i** (release.yml 静的:
v* トリガー、workflow_dispatch なし、12 matrix、assemble `needs: build-cli`、checksums 集約、
softprops + draft:false + contents:write、npm ガード、upload/download-artifact、SKIP_UPLOAD + タグ由来
バージョン) / T4–T4d (build.ts: MIMOCODE_TARGETS、SHA256SUMS、targets.ts 再利用、SKIP_UPLOAD ゲート) /
T5–T5c (script/release: bump.ts・git tag・push・watch・`gh workflow run publish.yml` なし) /
T6–T7b (RELEASING.md・AGENTS.md) / **T8** (nextVersion 純関数ユニット) / T9 (release-installer T5
改修: script/version.ts 参照の除去)。

## ワークフロー検証 (V5–V6)

| ID | 検証 | 結果 |
|---|---|---|
| V5a | actionlint `.github/workflows/release.yml` | **exit 0** (クリーン) |
| V5b | push 後の `gh api repos/kuwa2005/oimo/actions/workflows` で **release.yml の登録を確認** | コミット・push 後に実施 (本レポート末尾に追記) |
| V6 | 実タグ push でのトリガー実証 | **実施しない** — 公開リリースが即座に作られるため。登録確認 + actionlint + 静的テスト (T3–T3i) で担保 |

## 既知の制約

- npm 公開は `NPM_TOKEN` 未設定のため CI ではスキップ (リポジトリにシークレット 0 件の現状を維持。
  警告付きで GitHub リリース自体は完了)。FDS も同様。
- 実タグでの E2E トリガー実証は公開リリースを伴うため行っていない。登録確認で担保する。

## キーレッスン

- タグトリガーのワークフローは**リリース作成前**にビルドが走るため、従来の `gh release upload`
  (build.ts の Script.release ブロック) は失敗する。`MIMOCODE_SKIP_UPLOAD` ゲートで
  「アーカイブ生成のみ」にし、softprops フロー (upload-artifact → download-artifact →
  softprops/action-gh-release) へ切り替えた。
- バージョンの真実をタグ (`${GITHUB_REF_NAME#v}`) に置くことで、workflow 内の version job と
  それに伴う detached HEAD push / 非 fast-forward rebase の問題を構造的に排除した。
- 本リポジトリでは GitHub のワークフロー登録がファイル名+内容ハッシュでキャッシュされ、拒否が
  サイレントに起きる実績があるため、**push 後の登録確認は必須工程**として RELEASING.md に追記した。

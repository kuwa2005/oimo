# Report: Release v0.1.14 (operational)

- Status: Complete
- Date: 2026-08-07
- Spec: [release-0.1.14.md](../specs/release-0.1.14.md)

## 実施内容

v0.1.14 を GitHub Releases として公開した。旧 publish.yml (workflow_dispatch) 方式の最終実行。

- バージョン: **v0.1.14** (`./script/release --version 0.1.14` — package.json が 0.1.10 のままのため
  明示指定でカット。タグ v0.1.13 の次)
- 公開日時: **2026-08-07T13:12:55Z** (draft=false, prerelease=false)
- アセット: **12 アーカイブ** (darwin-arm64 / darwin-x64 / darwin-x64-baseline / linux-arm64 /
  linux-arm64-musl / linux-x64 / linux-x64-baseline / linux-x64-baseline-musl / linux-x64-musl /
  windows-arm64 / windows-x64 / windows-x64-baseline) + **SHA256SUMS**
- URL: https://github.com/kuwa2005/oimo/releases/tag/v0.1.14

## 経過

1. 初回 run 31180686914 が publish ジョブの SHA256SUMS ステップで失敗
   (`could not find any host configurations` — ステップ単位 env の `$TAG`/`$GH_REPO` が空で
   `gh release download "" --repo ""` が実行されたため)。
2. 修正 `fa73539ac` (env をジョブレベルへ移動) → 新規 dispatch (run 31181344253) で成功。
   `gh run rerun --job` は元のワークフローファイルを再現するため修正は反映されない (この gh 版に
   --latest なし) — 新規 dispatch でのみ有効と実証済み。
3. ユーザーがローカルコマンドを中断した後もワークフローは完走 (abort はローカル watch のみを殺す)。
4. draft 検証用に作った `v0.1.14` draft は `gh release delete --cleanup-tag` で削除
   (タグ ref 不在の HTTP 422 が返るが削除自体は成功 — 未公開 draft のため安全)。

## 検証

- run 31181344253: **SUCCESS** (3m33s、12 build-cli ジョブ + publish)
- `gh release view v0.1.14`: 12 アセット + SHA256SUMS、draft=false
- インストーラー検証は 2026-08-06 の release-installer.test.ts 10/10 (継続的に green)

## キーレッスン (次回以降に承継)

- publish.yml (dispatch 方式) は本リリースをもって廃止 — 以降はタグプッシュ方式 (release.yml) へ移行。
- ワークフロー修正の反映は常に新規発火 (rerun は古いファイルを再現)。

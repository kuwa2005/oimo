# Report: docs ビューア (docs/index.html 左右 2 ペイン)

- 日付: 2026-08-06
- Spec: docs/compose/specs/docs-index-viewer.md (Requirements Lock Approved 2026-08-06)
- 状態: **実装完了・検証済み**

## 概要

--se モードの自律エージェント実行により docs/ 配下へ次々と生成されるドキュメント (現在 62 ファイル:
specs / spec / reports / plans / architecture / harness / RELEASING.md) を一覧・閲覧するための
左右 2 ペイン・ビューア `docs/index.html` を作成した。

- 左ペイン: ディレクトリ別グループ (トップ / Specs / Spec / Plans / Reports / Architecture / Harness) +
  インクリメンタル検索フィルタ。
- 右ペイン: 選択文書を marked.js で描画。タイトル + パス表示、`<script>` 等の除去によるサニタイズ。
- 単一自己完結 HTML: 全文書本文・marked.js・CSS・JS をインライン (外部参照ゼロ) — file:// /
  GitHub Pages / オフラインすべてで動作。
- テーマ: prefers-color-scheme 自動 + 手動トグル (localStorage 永続)。ディープリンク (#パス) 対応。

## 実装内容

| ファイル | 内容 |
|---|---|
| `script/build-docs-index.ts` (NEW, chmod +x) | 生成スクリプト。`collectDocs` (Bun.Glob 再帰スキャン・ソート) / `titleOf` (frontmatter → H1 → ファイル名) / `groupOf` (ディレクトリ別) / `escapeForScript` (`<` → `\u003c` で `</script>` 無害化) / `renderDocsIndex` (単一 HTML 生成) を純関数化、メイン処理は `import.meta.main` ガード |
| `script/vendor/marked.min.js` (NEW) | marked v12.0.2 (MIT) を vendored。生成 HTML にインライン埋め込み (プレースホルダ split/join 方式 — テンプレートリテラル挿入だと将来版のバッククォートで壊れるため) |
| `docs/index.html` (生成物, ~760KB) | 62 文書の manifest JSON (JSON.stringify + `<` エスケープ) と marked、ビューア JS を同梱 |
| `.github/workflows/pages.yml` (編集) | Checkout 直後に Setup Bun + `bun script/build-docs-index.ts` を追加 — 公開 Pages はデプロイ前に常に再生成 |
| `AGENTS.md` (編集) | 「docs/index.html は生成物 — 文書追加・変更時は `bun script/build-docs-index.ts` で再生成」を追記 |

## セキュリティ設計

- 埋め込みは `JSON.stringify(...).replace(/</g, "\\u003c")` — manifest 内の `</script>` を無害化。
  テスト T5 で「生成 HTML の `</script>` は閉じタグ 3 つ (manifest / marked / アプリ) のみ」を保証。
- 描画時: `DOMParser` でパース後に `script, iframe, object, embed` を除去してから innerHTML へ
  (marked はデフォルトでサニタイズしないため)。

## テスト結果

実行: `bun test --timeout 30000 test/cli/docs-index.test.ts` → **8 pass / 0 fail (286 expect)**

| ID | 内容 | 結果 |
|---|---|---|
| T1 | collectDocs が docs/ 全 md をソート順で検出 | PASS |
| T2 | titleOf の frontmatter / H1 / ファイル名フォールバック | PASS |
| T3 | groupOf のディレクトリ別グループ分け | PASS |
| T4 | escapeForScript の `</script>` 無害化 + JSON 往復 | PASS |
| T5 | 生成 HTML の構造 (左右ペイン・manifest・marked・テーマ) + `</script>` が閉じタグ 3 つのみ | PASS |
| T6 | renderDocsIndex の決定性 (バイト一致) | PASS |
| T7 | E2E — 実スクリプト実行 exit 0、全 62 文書が manifest に含まれ JSON パース可能 | PASS |
| T8 | pages.yml 再生成ステップ + AGENTS.md 参照の存在 | PASS |

## 検証 (typecheck・実機)

| 検証 | コマンド/方法 | 結果 |
|---|---|---|
| typecheck | `bun typecheck` (packages/opencode, tsgo) | PASS |
| 生成 | `bun script/build-docs-index.ts` | exit 0、`docs/index.html generated (62 docs)` |
| 決定性 | 再実行 → サイズ 760379 バイト一致 (T6 でバイト一致も保証) | PASS |
| HTTP 配信 | Bun.serve で docs/ を配信し `GET /index.html` → 200、manifest / marked / 文書パスを含む | PASS |
| 自己完結性 | `<script src=` / `<link href=` / `<img src="http` / `@import` の静的リソース読み込みがゼロ (見つかった https:// は全て文書本文テキスト) | PASS |
| ブラウザ描画 | ヘッドレスブラウザが環境に無いため、描画ロジック (manifest パース・描画・検索・テーマ) は純関数 + 生成 HTML の静的検証で代替検証 (制約事項) | — |

## 運用

```bash
# 文書を追加・変更したら再生成 (ローカル)
bun script/build-docs-index.ts

# GitHub Pages (https://kuwa2005.github.io/oimo/docs/) は
# pages.yml がデプロイ前に自動再生成するため、push だけで最新化される
```

## 知見

- **JSON 埋め込みの安全パターン**: `JSON.stringify(...).replace(/</g, "\\u003c")` は HTML の script
  要素内でも `</script>` を完全に無害化し、`JSON.parse` で完全往復する。HTML エスケープや base64 より
  単純で堅牢。
- **vendored JS のテンプレート埋め込み**: ミニファイ済み JS をテンプレートリテラルに `${src}` で
  挿入すると、将来版にバッククォートや `${` が含まれた瞬間に壊れる。プレースホルダ置換
  (`template.split("__PLACEHOLDER__").join(src)`) が安全。
- **marked はデフォルトでサニタイズしない** — 描画結果を DOMParser に通して script/iframe を除去
  する最小防御をビューア側に実装した (文書はリポジトリ内の信頼済みコンテンツのため最小限で十分)。
- **ページサイズの一見矛盾**: 760KB (UTF-8 バイト) vs fetch の `text().length` 639K (UTF-16 文字数)
  は日本語マルチバイトによる見かけの差で、実体は同一。

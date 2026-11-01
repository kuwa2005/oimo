# Auto (無料) カタログと Free Claude Code の同期

Open Mimo Code の `auto/free` は **内製の first-frame フォールバック**で動く。Free Claude Code（FCC）はランタイム依存ではなく、**無料候補カタログの上流**として定期取り込みする。

将来の `auto/paid` / `auto/hybrid`（無料を使い、能力不足で有料へ）は [auto-mode-roadmap.md](./auto-mode-roadmap.md) を参照。

## 境界

| 取り込む | 取り込まない |
|----------|----------------|
| 無料向けデフォルト / smoke 既知の `provider/model` 候補 | Python `ProviderExecutor` / Admin UI |
| FCC `provider_id` → OIMO provider id マップ更新 | Anthropic / Responses wire 変換 |
| ドキュメント上の MODEL_FALLBACKS 例のうち無料寄り | クライアント向け proxy ランチャ |

Failover 状態機械（first-frame コミット）は OIMO の TypeScript が所有する。仕様の参照元は FCC の `docs/provider-failover-and-routing.md`。

## 同期手順

```bash
# 既定: ../free-claude-code（このリポジトリの隣）
bun script/sync-auto-free-catalog.ts

# パス指定
FCC_ROOT=/home/ubuntu/workspace/free-claude-code bun script/sync-auto-free-catalog.ts
```

出力: [`packages/opencode/src/provider/auto-free-catalog.json`](../packages/opencode/src/provider/auto-free-catalog.json)

マップ: [`packages/opencode/src/provider/auto-free/provider-map.ts`](../packages/opencode/src/provider/auto-free/provider-map.ts)

## 差分レビュー観点

1. 新しい FCC provider_id が未マップで warn されていないか → マップに追加するか意図的スキップか
2. 候補に有料モデルが混入していないか（`:free` / Zen `cost.input===0` / 明示 note）
3. `opencode/big-pickle` が先頭付近に残っているか（ゼロ設定動作）
4. ToS 非準拠・スクレイプ系 endpoint を入れていないか（FCC 方針に合わせる）

## ランタイム上書き

`oimo.json`:

```json
{
  "auto_free": {
    "fallbacks": [
      "opencode/big-pickle",
      "openrouter/openai/gpt-oss-120b:free"
    ]
  }
}
```

設定がある場合はカタログの先頭列より優先。その後も **ロード済みの OpenCode Zen 無料モデル（`cost.input === 0`）は自動で末尾に追加**される。

## ゼロ設定で使えるもの

キーやログインなしでも、OpenCode Zen の無料プール（`apiKey: "public"`）上の **active な無料モデル**（`cost.input === 0` かつ `status !== deprecated`）が Auto(無料) の候補になる。設定不要で first-frame フォールバックが効く。

[`models.dev`](https://models.dev/api.json) の `opencode.models` を正とする。2026-11 時点の active 無料 8 件（試行優先順は [`zen-free-preferred-order.json`](../packages/opencode/src/provider/zen-free-preferred-order.json) → [`ZEN_FREE_PREFERRED_ORDER`](../packages/opencode/src/provider/auto-free/resolve.ts)）:

| 試行順 | model id | メモ |
|--------|----------|------|
| 1 | `big-pickle` | FCC 先頭・起動時プローブ |
| 2 | `mimo-v2.6-flash-free` | Zen 無料 MiMo（v2.5-free は deprecated） |
| 3 | `deepseek-v4.1-flash-free` | |
| 4 | `nemotron-3.5-lightning-free` | |
| 5 | `nemotron-3.5-super-vl-free` | |
| 6 | `glm-5.3-flash-free` | |
| 7 | `flint-40b-free` | |
| 8 | `beam-free` | |

検証: `bun script/sync-zen-free-preferred-order.ts`（`--write` で models.dev に新規 active が出たとき末尾追記）。

`big-pickle` は起動時プローブとカタログ prior で先頭を維持。他 7 件は Zen プールから自動追加され、上記順で failover する。

**MiMo について:** Xiaomi 直 API（`api.xiaomimimo.com` free-ai）や旧 `mimo-auto` / `mimo-free` は別枠（多く終了・403）。**ゼロ設定の無料 MiMo は Zen の `mimo-v2.6-flash-free`**。`mimo-v2.5-free` / `mimo-v2-flash-free` 等は models.dev 上 `deprecated`。

FCC 由来の OpenRouter / NVIDIA / Groq などは、利用者がキーを入れたときだけ候補に乗る（ボーナス）。

## アカウント＋APIキー設定ヘルパー

「無料」でも各社サイトでのアカウント作成が必要なプロバイダ向け:

- TUI: `/free-setup` またはモデル選択の「無料プロバイダのキーを追加…」
- 実装: `dialog-auto-free-setup.tsx` + `auto-free/setup-providers.ts`
- 流れ: 登録 URL をブラウザで開く → API キー貼り付け → `auth.set` → Auto(無料) 候補に反映

| プロバイダ | 登録 URL |
|-----------|----------|
| OpenRouter | https://openrouter.ai/keys |
| NVIDIA NIM | https://build.nvidia.com/settings/api-keys |
| Groq | https://console.groq.com/keys |

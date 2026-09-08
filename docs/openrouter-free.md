# OpenRouter (無料) ルーター

`openrouter-free/free` は **OpenRouter の `:free` モデル専用**の仮想モデルです。Auto(無料) `auto/free` とは独立しており、Zen 無料プールや他プロバイダーにはフォールバックしません。

## 前提

- **OPENROUTER_API_KEY 必須**（[openrouter.ai/keys](https://openrouter.ai/keys)）
- Auto(無料) には影響しません

## カタログ同期

OpenRouter 公開 API から `:free` かつ tool 対応・context ≥ 32k のモデルを取り込みます。

```bash
bun script/sync-openrouter-free-catalog.ts
```

出力: [`packages/opencode/src/provider/openrouter-free-catalog.json`](../packages/opencode/src/provider/openrouter-free-catalog.json)

## フォールバック（二段）

1. **OpenRouter ネイティブ** — 1 リクエストで `models[]` に **最大 3 件**（OpenRouter API 上限）を渡し、OpenRouter 側で切替
2. **oimo クライアント** — first-frame 規則で候補を 1 件ずつ試行（Auto(無料) と同型）

## 設定 (`oimo.json`)

```json
{
  "openrouter_free": {
    "fallbacks": [
      "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
      "openrouter/poolside/laguna-s-2.1:free"
    ],
    "preferred_order": [
      "nvidia/nemotron-3-super-120b-a12b:free"
    ]
  }
}
```

- `fallbacks` — 明示リスト（設定時はカタログ先頭列を置換）
- `preferred_order` — カタログ内の並び替え（model id のみ、`openrouter/` なし）

## TUI

モデル選択のピンに **OpenRouter (無料・API KEY必要)** が表示されます。キー未設定時は無料プロバイダ設定ダイアログへ誘導します。

## Auto(無料) との関係

将来、FCC 同期スクリプトが本カタログを参照する拡張は可能ですが、**現状は連動しません**。Auto(無料) の Zen バックボーンと FCC カタログは従来どおりです。

# oimo → agent-skills エクスポート

Open Mimo Code の **ビルトインスキル**、**Compose フェーズ**、**組み込みワークフロー**、**独自パターン**を、Cursor / OpenCode / oimo 共通の [agent-skills](https://github.com/kuwa2005/agent-skills) 形式へエクスポートする手順です。

## 境界

| エクスポートする | エクスポートしない |
|------------------|-------------------|
| ホスト横断で使える SKILL.md + scripts | `mimocode-docs`（oimo 製品リファレンス） |
| Compose 各フェーズ（`compose-phases` バンドル） | `drive-mimo`（oimo CLI 専用） |
| ワークフロー meta の portable 手順 | `sales/*`（営業特化・巨大） |
| `evolve` / `memory-search` の portable 版 | 本隊ランタイム（Auto failover 等）の TypeScript |

本隊の不変条件は [core-vs-skills.ja.md](./architecture/core-vs-skills.ja.md) のとおり **本隊のまま**。ポータブル化できる手順だけを agent-skills へ載せます。

## 実行

```bash
# 既定: ../agent-skills（oimo の隣）
bun script/export-agent-skills.ts

# パス指定
AGENT_SKILLS_ROOT=/path/to/agent-skills bun script/export-agent-skills.ts

# 確認のみ
bun script/export-agent-skills.ts --dry-run
```

出力先: `agent-skills/skills/<skill-name>/`

カタログ: `agent-skills/skills/optional-oimo.txt`（**optional** 扱い — 既存 `catalog.txt` は変更しない）

## エクスポート一覧

### 直接コピー（ビルトイン）

`packages/opencode/src/skill/builtin/.bundle/` からそのまま:

- `compose-next`, `deep-research`, `super-research`, `arxiv`
- `design-blueprint`, `skill-creator`, `playwright`
- `pdf-official`, `docx-official`, `pptx-official`, `xlsx-official`
- `modern-python-toolchain`, `research-paper-writing`, `learn-everything`, `loop`
- `data-analytics`, `product-design`, `html-to-video-pipeline`, `grok-build`
- `claude-code`, `codex`

### Portable  adaptation

| スキル | 内容 |
|--------|------|
| `evolve` | `.oimo/` パスを Cursor/OpenCode 向けに注記 + `references/host-paths.md` |
| `memory-search` | oimo DB 前提を明記；他ホストは git/log 代替 |

### バンドル

| スキル | ソース |
|--------|--------|
| `compose-phases` | `skill/compose/.bundle/*` → `references/<phase>/` |
| `oimo-workflows` | `workflow/builtin/*.js` の meta → `references/<name>.md` |
| `goal-driven-stop` | `/goal` 停止条件パターン（新規 portable スキル） |

## インストール（利用者向け）

```bash
# 1 件
curl -fsSL https://raw.githubusercontent.com/kuwa2005/agent-skills/main/install.sh | bash -s -- compose-next

# optional-oimo 掲載分をまとめて（リポジトリ clone 後）
cd agent-skills && ./install.sh $(grep -v '^#' skills/optional-oimo.txt)
```

## 検証

```bash
cd agent-skills && python3 validate_skills.py
```

## 運用

- oimo ビルトインを更新したら `bun script/export-agent-skills.ts` を再実行し、agent-skills 側で commit。
- 両方に存在するスキル（例: `frontend-design`）は **意図的に二重管理** — 片方だけ古くしない（[core-vs-skills.ja.md](./architecture/core-vs-skills.ja.md)）。

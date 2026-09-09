# マルチリポジトリ利用ガイド（oimo）

日本語 | [English](./README.en.md)

oimo は複数の独立した Git リポジトリを一つの **System Workspace（システムワークスペース）** として扱えます。  
業務機能単位の依頼に対し、関連リポを登録・識別し、境界を守ったまま横断作業へ進めるための基盤です。

| 文書 | 内容 |
|------|------|
| **本ページ** | クイックスタート・使い分け・現状のできること |
| [config-reference.ja.md](./config-reference.ja.md) | **`repos.txt` / `workspace.yaml` / `.gitmodules` のキー解説** |
| [samples/](./samples/) | コピペ用サンプル |
| [current-architecture.md](./current-architecture.md) | 現状アーキテクチャ調査（日本語） |
| [implementation-plan.md](./implementation-plan.md) | 実装計画・Phase 分割（日本語） |
| [../oimo-multi-repository-implementation-instructions.md](../oimo-multi-repository-implementation-instructions.md) | 要件・安全条件の指示書（日本語） |

---

## クイックスタート（推奨: `repos.txt`）

GitHub の URL を並べるだけで登録できます。

1. システム用フォルダを作る（親自体は Git でなくてよい）:

```text
mkdir -p ~/work/customer-platform/.oimo
cd ~/work/customer-platform
```

2. サンプルをコピーして URL を書き換える:

```bash
cp /path/to/oimo/docs/multi-repo/samples/url-list/repos.txt .oimo/repos.txt
# .oimo/repos.txt を編集 — https://github.com/... を1行1リポ
```

3. 兄弟ディレクトリへ clone（フォルダ名 = URL 末尾、または `id=`）:

```bash
git clone https://github.com/example-org/frontend
git clone https://github.com/example-org/backend
# またはヘルパー
bash /path/to/oimo/docs/multi-repo/samples/url-list/clone-from-repos-txt.sh
```

4. 主対象リポで oimo を起動:

```bash
cd backend && oimo
```

### 発見順

あるディレクトリを起点に、次の順で探します。

1. `.oimo/workspace.yaml`（`.yml` / `.json` / `.jsonc`、ルート直下も可）
2. `.oimo/repos.txt`（`repos.list` / `repositories.txt` も可）
3. `.gitmodules` → **superproject モード**

どれも無ければ従来どおり単一リポジトリ動作です。

### `repos.txt` 早見表

| 行 / トークン | 意味 |
|---------------|------|
| `name: <表示名>` | Workspace 表示名（省略時 `workspace`） |
| `primary: <id>` | 主対象の id（省略時は先頭リポ行） |
| `https://…` / `git@…` | リモート。ローカルは `<workspace>/<id>/` を期待 |
| ローカルパス | 既存 clone（相対は Workspace ルート基準） |
| `read-only` | 書込禁止 |
| `id=<id>` | Registry id（省略時は URL/パス末尾） |
| `role=<文言>` | 短い役割メモ |

詳細表: [config-reference.ja.md §1](./config-reference.ja.md)  
サンプル: [samples/url-list/](./samples/url-list/)

---

## 方式の選び方

| 状況 | 使うもの |
|------|----------|
| GitHub 上の複数リポをすぐ始めたい | **`repos.txt`** |
| 相対パス・役割・非 Git 補助 dir を細かく指定したい | **`workspace.yaml`** |
| 既に Git submodule で束ねている | **`.gitmodules` のまま**（追加設定不要） |
| YAML と `repos.txt` が両方ある | **YAML が優先**（発見順） |

---

## `workspace.yaml`（詳細指定）

役割や相対パスを明示するとき用です。

| キー | 意味 |
|------|------|
| `version` | `1` 固定 |
| `name` | Workspace 表示名 |
| `primary` | `repositories[].id` のいずれか |
| `repositories[].id` | 安定 id（表示は `id:相対パス`） |
| `repositories[].path` | 絶対または相対。`kind: git` なら **worktree ルート必須** |
| `repositories[].role` | 役割の説明 |
| `repositories[].access` | `read-only` \| `read-write` |
| `repositories[].kind` | `git`（既定）/ `directory` / `superproject` / `submodule` |
| `defaults.*` | 未登録 read/write・横断計画の要求 |

詳細: [config-reference.ja.md §2](./config-reference.ja.md)  
サンプル: [samples/siblings-yaml/workspace.yaml](./samples/siblings-yaml/workspace.yaml)

---

## `.gitmodules`（superproject）

`workspace.yaml` / `repos.txt` が無いとき、`.gitmodules` があると自動登録します。

| kind | 役割 |
|------|------|
| `superproject` | Workspace 管理用（原則 read-only）。アプリ実装の主戦場にしない |
| `submodule` | 実装・commit・PR の単位 |

oimo が読むキー: セクション名、`path`、`url`、`branch`  
→ [config-reference.ja.md §3](./config-reference.ja.md)

ローカルのみで検査（ネットワークしない）:

- recorded commit（superproject の gitlink）と checked-out commit
- tracking branch / remote / 初期化済みか / dirty
- 不一致・behind → **警告**（影響分析継続時も警告を残す）

**安全ルール**

- 通常の兄弟登録での入れ子 Git は拒否。superproject ⊃ submodule だけ許可
- `submodule update` / fetch / checkout は**自動実行しない**（影響を説明して承認）
- superproject のポインタ更新は、子リポの変更と**別 Change set**

サンプル: [samples/superproject/gitmodules.sample](./samples/superproject/gitmodules.sample)

---

## このリリースでできること（進行中）

| 能力 | 状態 |
|------|------|
| `repos.txt` / `workspace.yaml` / `.gitmodules` で登録 | 対応済み |
| パス解決、`repo-id:path`、read-only・未登録書込の拒否 | Resolver + 書込ゲート配線済み |
| doctor・セッション指紋（作成時キャプチャ） | 対応済み |
| CLI `oimo repos list\|doctor` / TUI `/repos` | 対応済み |
| 横断 grep（`repositories: [id…]` 明示時のみ） | Phase 2 一部対応 |
| 影響グラフ・計画付き横断編集・リポ別検証 | 予定（Phase 3–5） |

設定ファイルが無い単一リポ利用は従来どおりです。  
FDE（`oimo --fde`）と組み合わせると、API + UI + schema にまたがる現場スパイクに向きます（infra は `read-only` 推奨）。

---

## 常時の安全規則

1. 未登録パスへ書込まない  
2. `read-only` リポへ書込まない  
3. dirty な作業ツリーを勝手に stash / reset しない  
4. 検出した依存を根拠なしに事実扱いしない（Phase 3）  
5. `.env` や鍵を横断検索結果として LLM 文脈へ不用意に入れない  

---

## 関連リンク

- オリジナル機能一覧（§12 マルチリポ）: [`オリジナル実装.md`](../../オリジナル実装.md)
- リリース: [v1.2.0](https://github.com/kuwa2005/oimo/releases/tag/v1.2.0)

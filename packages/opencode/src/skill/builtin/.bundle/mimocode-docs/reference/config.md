# Open Mimo Code Configuration Reference

## File locations & precedence

Config is JSON or JSONC. Open Mimo Code discovers it by walking up from the cwd to the worktree root, then falls back to global.

- Project: `.oimo/oimo.json` or `.oimo/oimo.jsonc`
- Global: `~/.config/oimo/oimo.jsonc` or `oimo.json` (XDG config dir). New installs seed `oimo.jsonc`.
- Extra config dirs are also searched via `$MIMOCODE_CONFIG_DIR`.

Project config merges **over** global. Always include `"$schema": "https://oimo.xiaomi.com/mimocode/config.json"` for validation.

## On-disk data layout

Base directories resolve from `MIMOCODE_HOME` if set (must be absolute → `<home>/{data,cache,config,state}`), otherwise from XDG:

| Kind | Default location | Holds |
|------|------------------|-------|
| data | `~/.local/share/oimo/` | memory, logs, `builtin_skills/<version>/`, bin |
| home install | `~/.oimo/` | local binary (`bin/`), **self-evolution logs** (`evolve/<projectID>/`) |
| config | `~/.config/oimo/` | global `oimo.jsonc` / `oimo.json` |
| cache | `~/.cache/oimo/` | caches, downloaded bins |
| state | `~/.local/state/oimo/` | runtime state, including TUI recent/favorite models in `model.json` |

Memory files live under `~/.local/share/oimo/memory/`:
- `projects/global/MEMORY.md` — project memory
- `sessions/<id>/checkpoint.md`, `notes.md`, `tasks/<id>/progress.md`
- `global/MEMORY.md` — cross-project user preferences

## Environment variables & flags

- `MIMOCODE_HOME` — override all base dirs (absolute path).
- `MIMOCODE_CONFIG_DIR` — extra config directory to search.
- `MIMOCODE_PURE` — run without external plugins (same as `oimo --pure`). Does **not** change models or Claude Code inheritance.
- `MIMOCODE_MIMO_ONLY` — pure-MiMo mode: don't inherit Claude Code settings (CLAUDE.md, `~/.claude/skills`), don't read provider API keys from env, fall back to the mimo-auto model.
- `MIMOCODE_DISABLE_LOG_ROTATION` — keep a single growing log file instead of rotating.
- `MIMOCODE_TEXT_TOOL_CALL_RETRY_LIMIT` — retries when a model emits a tool call as prose markup instead of a structured call (default 2).
- `MIMOCODE_EXPERIMENTAL_CRON` — scheduled prompts (cron/loop); **on by default**. `MIMOCODE_DISABLE_CRON` kills it at runtime. Tune loop keepalive with `MIMOCODE_LOOP_KEEPALIVE_BUDGET` (default 1) and `MIMOCODE_LOOP_KEEPALIVE_DELAY_S` (default 1200).
- `MIMOCODE_EXPERIMENTAL_TOKEN_EFFICIENCY_HEURISTIC` — shape-based compaction of bash output to save tokens; off by default.
- `MIMOCODE_DISABLE_BUILTIN_SKILLS`, `_COMPOSE_SKILLS`, `_EXTERNAL_SKILLS`, `_CLAUDE_CODE_SKILLS`, `_CODEX_SKILLS`, `_OPENCODE_SKILLS`, `_PROJECT_CONFIG`, `_CLAUDE_IMPORT` — feature toggles.
- `MIMOCODE_COMPLIANCE` — when `1`/`true`, redact high-confidence secrets from **user chat input** before persist and LLM send (same as `--compliance`). Default off.

## Top-level config keys

All optional.

### Models & providers
| Key | Purpose |
|-----|---------|
| `model` | Primary model, `provider/model` (e.g. `anthropic/claude-2`) |
| `small_model` | **Legacy / not recommended** — carried over from OpenCode for back-compat. Prefer configuring the `lite` group instead. If set, its literal `provider/model` still wins for cheap tasks (title generation, etc.); if unset, cheap tasks route through the `lite` group |
| `model_groups` | Named capability tiers usable anywhere a model string is accepted — see [Model groups](#model-groups) |
| `provider` | Custom provider configs & model overrides |
| `enabled_providers` / `disabled_providers` | Allowlist / blocklist providers |

For custom endpoints, adapter selection, provider reuse, credential handling, and verification, read @providers.md before editing.

### Model groups

`model_groups` lets you define named capability tiers and reference them by name (e.g. `"ultra"`) anywhere a `provider/model` string is accepted — the `model` key, an agent's model, the `actor` subagent `model` argument, and workflow model tiers.

Each group maps a name to either a single default model (string shorthand) or an object with a `default` plus optional member `models`:

```jsonc
{
  "$schema": "https://oimo.xiaomi.com/mimocode/config.json",
  "model_groups": {
    // string shorthand: the group IS its default model
    "lite": "anthropic/claude-haiku",
    // object form: a default plus alternates on other providers
    "standard": {
      "default": "anthropic/claude-sonnet",
      "models": ["anthropic/claude-sonnet", "openrouter/xiaomi/mimo-v2.5"]
    },
    "ultra": "anthropic/claude-opus-4-8"
  },
  "model": "standard"
}
```

**Resolution rules:**
- A ref containing `/` is a literal `provider/model` and is used as-is.
- A ref without `/` is a group name. If configured, Open Mimo Code is **provider-aware**: it prefers a member on the caller's current provider, otherwise falls back to the group's `default`.
- `ultra`, `standard`, `lite` are **built-in tier names**. If you reference one but haven't configured it, it silently falls back to the default model (zero-config never errors).
- Any other unconfigured name errors with fuzzy suggestions of your defined groups.
- Cheap-task (small) model: **configure the `lite` group** — that is the recommended path. The legacy `small_model` literal, if set, still takes precedence for back-compat, but is not recommended for new configs.

Use groups when you want one label (`"standard"`) to map to different concrete models per provider, or to swap tiers globally without editing every agent/model reference.

### Agents
| Key | Purpose |
|-----|---------|
| `default_agent` | Primary agent when none specified (falls back to `build`) |
| `agent` | Per-agent config: `plan`, `build`, `general`, `explore`, `title`, `summary`, `compaction`, plus custom |
| `username` | Display name in conversations |

Prefer a markdown file (`.oimo/agent/<name>.md`, body = system prompt) for defining a custom agent/mode — see the "Custom agents & modes" section in @guide.md. Use the `agent` config key for short, inline per-agent overrides.

### Tools, skills, MCP, extensions
| Key | Purpose |
|-----|---------|
| `skills` | `paths[]` extra skill folders + `urls[]` remote skill indexes |
| `mcp` | MCP servers: `local` (command/env) or `remote` (url/headers/oauth); `{ "enabled": false }` disables one; `sampling` sets the client-sampling policy (`deny`/`ask`/`allow`, default `ask`) |
| `tools` | Record of tool-id → boolean enable/disable |
| `tool.invocation_style` | `json` (default) or `shell`; `tool.invocation_style_by_tool` for per-tool override |
| `command` | Custom slash commands |
| `plugin` | Plugin specs |
| `formatter`, `lsp` | Formatter & language-server config |
| `instructions` | Extra instruction files/globs to include |
| `permission` | Permission rules incl. `external_directory` allowlist |

### Context management

As context fills, Open Mimo Code auto-checkpoints (a background writer distills the conversation into `checkpoint.md`) and, near the limit, **rebuilds**: it inserts a boundary at the last successful checkpoint so earlier messages collapse to the checkpoint summary while recent messages are kept verbatim. If a checkpoint writer is still running when a rebuild is needed, the rebuild waits for it (with a visible "Preparing conversation context…" status) — briefly when a usable checkpoint already exists, longer for the very first one — then proceeds; if no checkpoint can be produced it falls back to lossy compaction. You can trigger a rebuild yourself any time with the `/rebuild` slash command.

The trigger is the model's prompt capacity (`limit.input` when the provider publishes one, else `limit.context`) minus the reserves, optionally lowered by `compaction.max_context`. `oimo models <provider>` prints the resolved window and the trigger per model, and `/status` shows both plus the current usage. Two things users hit here: a model's usable window depends on the route (ChatGPT/Codex subscription vs direct API key vs a reseller like OpenRouter can all differ for the same model name, and a 1M catalog figure does not mean the route serves 1M), and providers may price very long prompts higher (OpenAI charges 2x input / 1.5x output for GPT-5.6 requests above 272K input) — `compaction.max_context` is the knob for both.

| Key | Purpose |
|-----|---------|
| `compaction.auto` | Auto-compact when context full (default true) |
| `compaction.prune` | Prune old tool outputs (default true) |
| `compaction.tail_turns` | Recent user turns kept verbatim (default 2) |
| `compaction.preserve_recent_tokens` | Max recent tokens kept verbatim |
| `compaction.reserved` | Token buffer to avoid overflow |
| `compaction.max_context` | Compact earlier than the model window. One value for all models, or a map keyed `"<providerID>/<modelID>"` (wildcards allowed, longest pattern wins). Values: token count, `"300K"`, `"1M"`, or `"50%"` of the window. Always clamped to the provider cap — can only lower the trigger, never raise it. `0` = no budget. Set it from the TUI with `/context-limit` |
| `checkpoint.thresholds` | Context-fill triggers, e.g. `["40%","60%","80%"]` |
| `checkpoint.reserved` | Token buffer for checkpoint ops (default 20000) |
| `checkpoint.fork` | Fork parent prefix into writer session for cache reuse (default false) |
| `checkpoint.push_caps.*` | Per-section token caps for rebuild context (tasks_ledger, focus_task, checkpoint, memory, notes, global, recent_user, …) |
| `checkpoint.task_archive_days` | Days before done/abandoned tasks filtered out (default 7) |
| `checkpoint.memory_search_score_floor` | BM25 relative floor for memory search (default 0.15) |
| `memory.cc_index` | Index Claude Code memory under scope `cc` (default false; see privacy note in schema) |
| `history` | Conversation-history FTS index config |

### Autonomous / self-improvement
| Key | Purpose |
|-----|---------|
| `dream.auto` / `dream.interval_days` | Auto memory consolidation on session start (default true / 7 days) |
| `distill.auto` / `distill.interval_days` | Auto workflow packaging (default true / 30 days) |
| `evolve.auto` / `evolve.interval_days` | Auto Self Improvement Session + logs under `~/.oimo/evolve/<projectID>/` (default true / 14 days; opt-out with `evolve.auto: false`) |
| `evolve.skills.enabled` | Crystallize knowledge into `.oimo/skills` (default true, opt-out) |
| `evolve.briefs.enabled` | AI-to-AI product briefs under `~/.oimo/evolve/<projectID>/briefs/` (default true, opt-out → later opt-in) |
| `evolve.friction.enabled` | Friction / Human Attention Cost analyses under `~/.oimo/evolve/<projectID>/friction/` (default true, opt-out) |
| `evolve.backlog.enabled` | Self Improvement Backlog at `~/.oimo/evolve/<projectID>/backlog/BACKLOG.md` (default true, opt-out) |
| `evolve.session_review.enabled` | Session self-evaluation under `~/.oimo/evolve/<projectID>/reviews/` (default true, opt-out) |
| `evolve.condition_triggers` | Allow early auto-evolve on HAC/corrections/tool-churn (default true; disable with `evolve.auto: false`) |
| `/evolve-status` | TUI Self Evolution dashboard (briefs, backlog, snapshots) |
| `evolve_status` tool | metrics / dashboard / snapshot / rollback / evaluate |
| `evolve-review` workflow | Multi-agent review of a product brief (Human-in-the-loop) |
| `voice.asr_model` | ASR model (default `xiaomi/mimo-v2.5-asr`) |
| `voice.control_model` | Voice control model (default `xiaomi/mimo-v2.5`) |
| `compose` | Compose mode config (`docs` dir default `docs/compose`, `docs_absolute`) |
| `workflow.maxConcurrentAgents` | Process-wide subagent concurrency ceiling (default min(16, 2×cores)) |
| `workflow.maxDepth` | Max workflow nesting depth (default 8) |

### Autonomy (AI-driven delivery)

| Key | Purpose |
|-----|---------|
| `autonomy.enabled` | Enable autonomy stack: hearing (or Super Auto), then non-stop delivery until judge confirms completion |
| `autonomy.hearing_first` | Ask the user and lock before never-ask (default true). `false` = Super Auto |
| `autonomy.persona` | When hearing_first: `se` (default, Requirements Lock) or `fde` (Forward Deployed Engineer, Solution Lock, PoC before lock) |
| `autonomy.docs_evidence` | Require documentary evidence in the stop condition (default true) |
| `autonomy.max_turns` | Max judge re-entries per task (default 50) |
| `autonomy.max_duration_ms` | Wall-clock budget per task in ms (default 7_200_000) |
| `autonomy.max_cost_usd` | Soft cost ceiling per task in USD (default 10) |
| `autonomy.judge_max_retries` | Judge retries before `judge_failed` stop (default 2) |
| `experimental.auto_continue` | **Deprecated** — alias for `autonomy.enabled` (does not auto-submit predicted prompts) |

#### Modes (CLI / `/auto`)

| Mode | CLI | Hearing | Lock gate | PoC before lock | never-ask |
|------|-----|---------|-----------|-----------------|-----------|
| none | (default) | ask as needed | — | — | off |
| normal (SE) | `--se` / `--autonomy` | clarify with you | **Requirements Lock** | no (no prod code until lock) | after lock |
| **fde** | **`--fde`** | field discovery + Level 1–3 | **Solution Lock** | **yes** (spikes only) | after lock |
| special | `--spauto` / `--autosp` | self-answer | — | n/a | from launch |

**SE (`--se`):** hearing-first compose agent. After `Requirements Lock` approval, never-ask engages for non-stop implementation with SE documentary evidence (hearing log, requirements, tests, verification).

**FDE (`--fde`):** Forward Deployed Engineer. Frame the field problem, propose Level 1–3 solutions, allow PoC spikes before lock, then ask `Solution Lock`. After approval, implement, verify, and leave FDE evidence: Understanding / Problem / Solutions(L1–3) / PoC / Implementation / Verification (Before/After when possible) / Next Improvement ≤3.

**Super Auto (`--spauto`):** same autonomy stack with `hearing_first=false` — never-ask and skip-permissions from turn one. **Every launch** shows a red risk acknowledgment (refuse is default; interactive TTY required).

**Combined (`--se --fde`):** Allowed. Autonomy persona follows FDE (Solution Lock). **Friction Learning** analyzes with both SE (how to implement/verify) and FDE (business intent / field expectation) lenses.

**Friction Learning** (no dedicated `--friction-*` flag): when `--se` and/or `--fde` is on, oimo detects corrective feedback (後出し条件、やり直し、否定、差し戻し、検証要求、バグ報告), classifies gaps (Instruction / Interpretation / Implementation / Verification / …), writes rule candidates under `~/.oimo/evolve/<projectID>/friction/` and `.oimo/friction/rules.json`, and injects applicable rules into later similar tasks. Temporary phrases (`今回だけ`) stay Task-scoped. Users can disable bad rules (`今後その確認はいらない`).

**Character (presentation only):** 未指定=OFF、`--character`=ON (default 口調)、`--character=off` で明示 OFF。Friction フィードバックの言い回しだけ変える — 責任分類・学習内容・推論は変わらない。将来 `--character=osaka` 等は renderer 追加のみ。

**Mid-session handoff:** `/auto` (none / normal / fde / special), or continue with flags: `oimo -c --fde`, `oimo -c --se`, or `oimo -c --se --fde`.

**Soft continue (`--warm`):** Starts a **new** session instead of resuming history. Injects a one-turn brief (title, open todos, last assistant snippet, `.oimo/oimo-session-*.md` result tail). Scoped to the **current directory** (unlike `-c`). Use `--warm=deep` to also set `contextFrom` / `contextWatermark` at the last compaction boundary. Mutually exclusive with `-c`.

**`-c` alone does not re-apply CLI flags.** `--se` / `--fde` / `--character` / `--auto` are process env for that launch only (not stored on the session). To keep the persona, pass the flag again or switch with `/auto` (persists mode to global config).

### Compliance (enterprise input redaction)

Opt-in. Default **off** — personal “paste a key so the agent can configure it” workflows stay possible unless you enable this.

| Key / flag | Purpose |
|------------|---------|
| `compliance.redact_input` | When `true`, mask high-confidence secrets in user chat text before DB persist and LLM send |
| `--compliance` / `MIMOCODE_COMPLIANCE=1` | Same as `redact_input: true` for that process (overrides config) |

**What is masked:** AWS access keys (`AKIA`/`ASIA`), PEM private keys, JWTs, Bearer/Token opaques, GitHub/OpenAI/Anthropic/Slack token shapes, DB connection URLs, and `password=` / `api_key=` assignments with long non-placeholder values.

**What is not:** PII, tool-read `.env` contents, synthetic/internal text, short dummies, placeholders (`***`, `changeme`, `$PASSWORD`), or ordinary code (`password?: string`, `getPassword()`).

On mask, the TUI shows a short toast with **count only** (no secret values). Sending is never blocked — placeholders like `[REDACTED:aws_key]` remain in context.

If you are writing docs that intentionally include real-shaped example keys, leave compliance off for that session.

### Multi-repository workspace files

Not merged into `oimo.jsonc` yet — discovered beside the project:

| File | Purpose |
|------|---------|
| `.oimo/repos.txt` | Simplest: one GitHub URL per line (`read-only`, `id=`, `name:`, `primary:`) |
| `.oimo/workspace.yaml` | Full registry (roles, relative paths, defaults) |
| `.gitmodules` | Auto superproject + submodule registration |

See `docs/multi-repo/README.md` and samples under `docs/multi-repo/samples/`.

**Anti-burn (loop stop):** If the assistant clearly hands control back (“次の指示をお待ち”, “all tasks complete”, etc.), the goal stops (`waiting_user` / `completed`) instead of re-entering. Soft rate-limit auto-retry skips when that handoff is detected (max 2 retries per storm). Hearing-phase think-only auto-continues are capped at 2; automatic goal re-entries without a real user message stop after 5.

High-risk operations (`bash_delete`: rm, force push, destructive git, etc.) still require explicit user approval in `--se` / `--fde` mode; `--spauto` (after the launch gate) and `--auto` also set `MIMOCODE_AUTO_APPROVE_DELETE` so those do not block.

### Experimental
| Key | Purpose |
|-----|---------|
| `experimental.maxMode` | `max` agent runs N parallel reasoning candidates, judge picks winner (`candidates`, default 5) |
| `experimental.batch_tool` | Enable the batch tool |
| `experimental.predict_next_prompt` | Inline ghost-text next-prompt prediction (default on) |
| `experimental.continue_loop_on_deny` | Keep looping when a tool call is denied |
| `experimental.primary_tools` | Tools restricted to primary agents |
| `experimental.mcp_timeout` | MCP request timeout (ms) |

### Misc
| Key | Purpose |
|-----|---------|
| `autoupdate` | `true` / `false` / `"notify"` |
| `share` | `"manual"` / `"auto"` / `"disabled"` |
| `snapshot` | Filesystem snapshot tracking for undo/redo (default true) |
| `logLevel` | Log verbosity |
| `server` | Config for `oimo serve` |
| `enterprise.url` | Enterprise endpoint |

## Example: common tweaks

```jsonc
{
  "$schema": "https://oimo.xiaomi.com/mimocode/config.json",
  "model": "anthropic/claude-opus-4-8",
  "model_groups": { "lite": "anthropic/claude-haiku" },
  "dream": { "auto": true, "interval_days": 3 },
  "evolve": {
    "auto": true,
    "interval_days": 14,
    "skills": { "enabled": true },
    "briefs": { "enabled": true },
    "friction": { "enabled": true },
    "backlog": { "enabled": true },
    "session_review": { "enabled": true }
  },
  "compaction": { "tail_turns": 3 },
  "permission": { "external_directory": { "/tmp/**": "allow" } },
  "mcp": {
    "my-server": { "type": "local", "command": ["node", "server.js"] }
  }
}
```

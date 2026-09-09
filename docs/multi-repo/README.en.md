# Multi-repository usage (oimo)

[日本語](./README.md) | English

oimo can treat several independent Git repositories as one **system workspace**.

| Doc | Contents |
|-----|----------|
| **[README.md](./README.md) (Japanese, primary)** | Quick start and overview |
| [config-reference.ja.md](./config-reference.ja.md) | Full key reference for `repos.txt` / `workspace.yaml` / `.gitmodules` |
| [samples/](./samples/) | Copy-paste samples |
| [current-architecture.md](./current-architecture.md) | Architecture survey (Japanese) |
| [implementation-plan.md](./implementation-plan.md) | Phased plan (Japanese) |

---

## Quick start (recommended): `repos.txt`

1. Create a folder for the system (does not need to be a git repo):

```text
mkdir -p ~/work/customer-platform/.oimo
cd ~/work/customer-platform
```

2. Copy the sample and edit URLs:

```bash
cp /path/to/oimo/docs/multi-repo/samples/url-list/repos.txt .oimo/repos.txt
```

3. Clone siblings (folder name = last URL segment, or `id=`):

```bash
git clone https://github.com/example-org/frontend
git clone https://github.com/example-org/backend
bash /path/to/oimo/docs/multi-repo/samples/url-list/clone-from-repos-txt.sh
```

4. Launch from the primary app repo: `cd backend && oimo`

Discovery order: `workspace.yaml` → `repos.txt` → `.gitmodules` (superproject).

### `repos.txt` at a glance

| Token | Meaning |
|-------|---------|
| `name:` / `primary:` | Display name / default repo id |
| URL / local path | Remote (expect `<workspace>/<id>/`) or existing clone |
| `read-only` / `id=` / `role=` | Deny writes / override id / short role |

Full tables (Japanese): [config-reference.ja.md §1](./config-reference.ja.md)

## `workspace.yaml` / `.gitmodules`

See the Japanese guide and [config-reference.ja.md](./config-reference.ja.md) §§2–3. Samples under [samples/](./samples/).

## Phase 1 status

Registry + Resolver + doctor + fingerprint: **yes**. Cross-repo search / impact / planned multi-edit / TUI `/repos`: **planned**.

## Safety

No writes to unregistered or `read-only` repos; no auto stash/reset; no auto `submodule update`; secrets must not be dumped into LLM context from cross-search.

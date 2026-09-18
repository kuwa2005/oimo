# FDE / SE improvement baseline (2026-09-18)

## Target

| Field | Value |
|------|--------|
| Branch | local `main` (post multi-repo + evolve commits) |
| Date | 2026-09-18 |
| OS | Linux (WSL2) |
| Prerequisite | multi-repo COMPLETE; evolve COMPLETE (formal) |
| Contract | [fdese-improvement-instructions.md](./fdese-improvement-instructions.md) |

## Existing tests (baseline)

```bash
cd packages/opencode
bun test test/config/autonomy.test.ts test/session/goal.test.ts
# 21 pass (2026-09-18)
```

Known CLI help/TUI spawn timeouts remain as documented in the instruction §4.2 (not SE judgment quality).

## Current public surface

| Entry | Mechanism | Notes |
|-------|-----------|--------|
| `oimo --se` | `args.autonomy` → `MIMOCODE_AUTONOMY` + friction SE | Alias of `/auto normal` |
| `oimo --fde` | `MIMOCODE_FDE` + friction FDE | persona fde |
| `oimo --se --fde` | Both env; TUI allows; persona prefers FDE; both friction lenses | `session list` **rejects** `--se --fde` |
| `oimo --spauto` | Super Auto; hearing_first false | Risk prompt every launch |
| `/auto` | `ConfigAutonomy.patchForMode` + `applyProcessEnv` | Writes global config + process.env |
| Config | `autonomy.enabled/hearing_first/persona` | Overlay from Flag at load |

## Current types (to replace)

- `Mode = "none" \| "normal" \| "special" \| "fde"` (`normal` ≠ public `--se` name)
- `GoalPhase = "hearing" \| "execute"` only
- Process-global `goalRef` for lock → execute
- Lock via header regex + flat affirmative answer regex

## Known release blockers present in code

Mapped to instruction §4.3: **#1–#15, #17, #23–#24, #28–#30** are confirmed in current tree (see [gap-map.md](./gap-map.md)).

## Migration stance

Do not delete CLI flags. Introduce `AutonomyProfile` / `AutonomyRun` alongside; adapter maps legacy Mode → profile.

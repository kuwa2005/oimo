# Evolve complete-version baseline (2026-09-18)

Recorded at start of `docs/evolve/completion-instructions.md` implementation (§2.2).

| Field | Value |
|------|--------|
| Commit | `4e757d012e` (at baseline start; working tree may advance) |
| Branch | `main` |
| OS | Linux WSL2 (`6.18.33.2-microsoft-standard-WSL2`) — formal for this effort |
| Prerequisite | `docs/multi-repo/completion-evidence.md` = **COMPLETE**, EvidenceJudge `ok:true` |

## Existing config defaults (pre-migration)

| Key | Default (config.ts) | Notes vs complete-spec |
|-----|---------------------|------------------------|
| `dream.auto` | false | Matches opt-in |
| `dream.interval_days` | 7 | OK |
| `distill.auto` | false | Matches opt-in |
| `distill.interval_days` | 30 | OK |
| `evolve.auto` | **true** (opt-out) | Spec wants opt-in + migration UI |
| `evolve.interval_days` | 14 | OK |
| hard briefs / friction / backlog / reviews | opt-out true | Spec: auto hard brief opt-in |
| `evolution.*` unified key | **missing** | Spec §15 |

## Existing tests (baseline)

```bash
cd packages/opencode && bun test test/evolve
# 8 pass historically → 11 pass after EvolutionState / WritePolicy (this PR wave)
```

## Known safety gaps at baseline

1. bash / interactive / tool-script can bypass evolve write sandbox (blocker #1)
2. Agent sandbox uses string prefix under `~/.oimo/evolve` without per-project realpath Policy (partially addressed by `EvolutionWritePolicy`)
3. No SQLite Evolution state (addressed by `evolution` / `evolution_audit` tables)
4. Metrics before/after may overlap; not rate-normalized (blocker #8/#9)
5. Scenario observation partly self-reported (blocker #10)
6. Memory provenance / skill staging validators incomplete (#11/#12)
7. Brief schema not machine-validated (#13)
8. evolve-apply approval binding incomplete (#14/#15)
9. Path conventions / multi-repo knowledge separation incomplete (#16–#19)
10. No soft/hard E2E to completion evidence (#20)

## Migration policy (saved artifacts)

- Keep `~/.oimo/evolve/<projectID>/` markdown logs readable
- New Evolution rows are additive; do not delete existing briefs on upgrade
- Unified `evolution` config will deprecate but still read legacy `dream`/`distill`/`evolve` keys

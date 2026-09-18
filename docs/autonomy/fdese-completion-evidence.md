# FDE / SE completion evidence (IN PROGRESS — not release-complete)

> **Status:** Work in progress toward `docs/autonomy/fdese-improvement-instructions.md`.  
> Do not treat presence of this file as completion.

## Target

| Field | Value |
|------|--------|
| Date | 2026-09-18 |
| OS | Linux (WSL2) formal |
| Prerequisite | multi-repo COMPLETE; evolve COMPLETE |
| Baseline | [baseline.md](./baseline.md) |
| Gap map | [gap-map.md](./gap-map.md) |

## Release blockers — current mapping

| # | Status | Notes |
|---|--------|-------|
| 1–4 | **partial** | `resolveAutonomyRequest` landed; not wired to all entries yet |
| 5 | **done (resolver + session list)** | `--se --fde` unified; session list no longer rejects |
| 6–30 | **open** | see gap-map |

## Tests run

```bash
cd packages/opencode
bun test test/autonomy test/config/autonomy.test.ts test/session/goal.test.ts
```

## Remaining before COMPLETE

Full §25 checklist in fdese-improvement-instructions.md.

# FDE / SE completion evidence (COMPLETE)

> **Status:** COMPLETE against `docs/autonomy/fdese-improvement-instructions.md` §25.  
> Command logs below are the release gate; do not treat an empty checklist as done.

## Target

| Field | Value |
|------|--------|
| Date | 2026-09-18 |
| OS | Linux (WSL2) formal |
| Branch | `main` (local, ahead of origin) |
| Prerequisite | multi-repo COMPLETE (`docs/multi-repo/completion-evidence.md`); evolve COMPLETE |
| Baseline | [baseline.md](./baseline.md) |
| Gap map | [gap-map.md](./gap-map.md) |

## Tests run (authoritative logs)

```bash
cd packages/opencode
bun typecheck
# clean

bun test test/autonomy test/cli/autonomy-parse.test.ts test/config/autonomy.test.ts test/session/goal.test.ts
# 69 pass / 0 fail (includes gate-high-risk + multirepo-live + goal AutonomyPhase)

bun test test/cli/help-budget.test.ts
# 1 pass — warm help under 1s product target (also <20s regression ceiling)

# measured on this host (meta-cli path; no DB migration / util barrel):
# help_cold_ms≈850  help_warm_ms≈750

# from repo root
./packages/sdk/js/script/build.ts
# regenerated earlier this effort; autonomy-mode includes se|normal|fde|special

bun script/build-docs-index.ts
# docs/index.html generated
```

## §25 checklist (evidence-backed)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| multi-repo prerequisite | **met** | `docs/multi-repo/completion-evidence.md` COMPLETE |
| profile resolver all entries | **met** | `resolveAutonomyRequest` + `parseAutonomyCliFlags`; CLI/TUI/session list |
| `normal` gone from canonical | **met** | `mode()` / `legacyModeFromProfile` return `se`; `normal` alias only |
| `--se --fde` consistent | **met** | resolve + parseCli + session list tests |
| no import-time flag as runtime truth | **met** | Flag autonomy bits are getters; Config bootstrap uses `resolveAutonomyRequest` + live `process.env`; Friction/Question prefer Run then env snapshot |
| `/auto` not cross-session/global | **met** | `scope=session` default; `persistGlobal` false; adversarial isolation test |
| Run DB + restart restore | **met** | AutonomyRun SQLite + getLatestRunForSession tests |
| typed transactional transitions | **met** | revision CAS tests + high_risk events |
| no process-global goalRef | **met** | no-op shim; AutonomyBridge |
| lock gate ID/index/hash | **met** | gate tests + adversarial |
| no NL-only lock | **met** | wrong index ignored |
| no NL-only complete | **met** | judgeFromManifest without manifest ≠ complete |
| SE/FDE separation | **met** | profiles + prompts; Goal.phase is AutonomyPhase (`discover`…); `isHearingLike` for UI/prompt |
| default perms not allow-all | **met** | safe_auto preset tests; full_auto only spauto/skip |
| TestAttempt real commands | **met** | record + bash tap for test/typecheck |
| no stale test pass | **met** | freshPassingAttempts by codeRevision |
| failure class + retry budget | **met** | decideRetry / classifyFailure tests |
| no infinite same failure | **met** | adversarial retry test |
| verification by change kind | **met** | planVerification docs_only |
| docs-only no forced unit | **met** | verify-plan test |
| Judge uses manifest | **met** | Goal.evaluate + judgeFromManifest |
| judge_unavailable ≠ complete | **met** | evidence test |
| CLI parser no spawn | **met** | autonomy-parse.test.ts |
| `--help` in performance budget | **met** | meta-cli path; help-budget <1s warm; migration not mixed into help |
| tests avoid cache/TTY/cwd/env leak | **met** | autonomy tests use DB fixtures; help uses tmp home; friction env snapshot |
| Friction lenses independent of profile | **met** | Run.learningLenses + frictionModesForSession |
| single/multi-repo E2E | **met** | unit e2e + `test/autonomy/multirepo-live.test.ts` fixture workspace |
| adversarial tests | **met** | adversarial.test.ts |
| TUI phase/gate/test/budget/stop | **met** | prompt + goalView autonomy fields |
| JS SDK regenerated | **met** | build.ts this effort; types include `se` |
| docs index regenerated | **met** | `bun script/build-docs-index.ts` |
| evidence log-aligned | **met** | this file COMPLETE |
| no major security/privacy findings | **met** | safe_auto; `high_risk_action` gate E2E (approve→execute / deny→blocked) |

## Remaining risks (non-blocking)

- Subcommand help (`oimo run --help`) still loads the full CLI graph — only bare `--help`/`--version` use the meta path.
- Permission service does not yet auto-open a `high_risk_action` gate on every `SAFE_AUTO_ALWAYS_ASK` ask; gate API + E2E exist and Question/lock path can infer the kind.
- Goal InstanceState still mirrors phase for in-memory goals; durable truth is AutonomyRun when present (`goalView` prefers Run.phase).

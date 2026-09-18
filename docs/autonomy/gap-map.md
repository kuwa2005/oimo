# FDE / SE gap map (30 blockers × current code)

| # | Blocker | Current evidence | Target |
|---|---------|------------------|--------|
| 1 | mode duplicated across CLI/Flag/env/Config/TUI | `flag.ts`, `thread.ts`, `config.ts` Flag overlay, `applyProcessEnv` | single `resolveAutonomyRequest` |
| 2 | import-time Flag | `Flag.MIMOCODE_*` truthy at import | EnvSnapshot at resolve time |
| 3 | `/auto` mutates process.env + global config | `applyProcessEnv`, `setAutonomyMode` | session Run only; `/auto default` separate |
| 4 | `normal` ≠ `se` | `Mode` includes `normal` | canonical `se`; alias only |
| 5 | `--se --fde` allowed in TUI, rejected in session list | `thread.ts` vs `session.ts` | one rule: profile=fde, lenses=[se,fde] |
| 6 | persona + friction lens not typed together | `friction/flags.ts` separate from persona | `learningLenses` on request/Run |
| 7 | Goal only in InstanceState | `session/goal.ts` | AutonomyRun in SQLite |
| 8 | phase hearing\|execute only | `goal-ref.ts` | AutonomyPhase set |
| 9 | goalRef + runFork races | `goal-ref.ts` | AutonomyService.transition CAS |
| 10 | lock via header regex | `isAutonomyLockHeader` | Gate.kind |
| 11 | any-question yes can lock | `isLockApproval` flattens all answers | bind to gate question index |
| 12 | awaiting/done one boolean | Goal helpers | StopReason enum |
| 13 | infer waiting/completed from phase | goal evaluate paths | explicit phase + events |
| 14 | natural-language complete | classifier / transcript | claims_complete → Judge only |
| 15 | confirm-wait as completed | same | HandoffSignal split |
| 16 | Judge full transcript | goal judge | Evidence Manifest |
| 17 | Judge unavailable differs | autonomy vs normal Goal | unified judge_unavailable |
| 18 | no independent test retry budget | — | VerificationBudget |
| 19 | always demand new tests/docs | prompts | Verification Planner by change kind |
| 20 | docs-only forced unit tests | prompts | docs-only plan |
| 21 | no failure classification | — | TestAttempt.status + class |
| 22 | assistant text as test evidence | Judge input | TestAttempt only |
| 23 | autonomy ≈ allow-all base | `MIMOCODE_DANGEROUSLY_SKIP_PERMISSIONS` | safe_auto policy |
| 24 | FDE high-risk not typed | — | high_risk_action gate |
| 25 | heavy CLI spawn tests | help/tui tests | parseCli pure + thin smoke |
| 26 | TUI test mutates cwd/env/TTY | thread tests | inject snapshots |
| 27 | Bun module cache workarounds | comments | no mock.module dependence |
| 28 | no deterministic E2E for lock/judge | — | autonomy-e2e tests |
| 29 | Goal/evidence scope vs multi-repo | partial Goal binding | Run.repository_ids + Change set |
| 30 | TUI lacks structured waiting UI | Goal sidebar limited | phase/gate/budget/stop display |

## Behavior matrix (current, pre-resolver)

| Input | Effective mode today | Friction lenses | Notes |
|-------|----------------------|-----------------|-------|
| (none) | none | — | |
| `--se` | normal (se) | se | |
| `--fde` | fde | fde | |
| `--se --fde` (TUI) | fde | se+fde | |
| `--se --fde` (session list) | **error** | — | blocker #5 |
| `--spauto` | special | — | hearing_first false |
| `/auto normal` | normal | se via env | global write |
| `/auto fde` | fde | fde | global write |
| `/auto special` | special | — | |
| `/auto none` | none | cleared | |

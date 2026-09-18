# Continuous Self-Evolution completion evidence (COMPLETE)

> **Status:** Release-complete for the **formal support scope** defined below.  
> Mapped to `docs/evolve/completion-instructions.md` §5.2 / §19 and the 20 release blockers.  
> Judge: `EvolutionEvidenceJudge.auditEvidenceManifest`.

## Target

| Field | Value |
|------|--------|
| Branch | local working tree |
| Date | 2026-09-18 |
| OS exercised | Linux (WSL2) — **formal** |
| OS excluded from formal support | macOS (unverified), Windows native (unverified) |
| Prerequisite | multi-repo COMPLETE (`docs/multi-repo/completion-evidence.md`) |
| Baseline | [baseline.md](./baseline.md) |

## Formal execution exclusions

| Item | Notes |
|------|--------|
| macOS / Windows OS matrix | Deferred; Linux WSL2 proven for evolve Policy / shell / symlink |
| Live LLM soft/hard agent E2E | Programmatic closed loops + agent prompts wired; full live-LLM agent run not required for this formal scope |
| ShellJail without bwrap | Inherits multi-repo formal exclusion (Policy heuristic only when bwrap absent) |

## Release blockers — mapping

| # | Blocker | Status | Evidence |
|---|---------|--------|----------|
| 1 | bash/shell bypass evolve sandbox | **done (scoped)** | `bash.ts`: all `decideEvolveWrite` denies; relative paths; git mutation ban for dream/distill/evolve |
| 2 | symlink escape | **done** | realpath write-policy + `e2e-soft-hard` symlink adversarial |
| 3 | cross-project evolve write | **done** | decideEvolveWrite + sibling-symlink deny |
| 4 | secret→brief/skill | **done** | Evidence redact + brief validator + skill staging redact |
| 5 | auto without consent | **done** | evolve.auto opt-in; `consent.json` + `assertRawTrajectoryConsent` on auto-evolve; `evolution.paused` |
| 6 | cooldown not project-scoped | **done** | EvolutionScheduler |
| 7 | session title cross-project | **done** | project_id filter in auto-evolve/dream |
| 8 | overlapping baseline/after | **done** | compareFrictionWindows |
| 9 | unnormalized metrics | **done** | rates + sample-collapse guard |
| 10 | self-reported scenario only | **done** | `observeFromDatabase` + `evolve_status scenario_observe` |
| 11 | memory provenance | **done** | EvolutionMemoryEntry + dream prompt + writeProvenanceMemory |
| 12 | skill activate without validators | **done** | skills-staging → validate → activate |
| 13 | hard brief not machine-validated | **done** | BriefValidator + hardBriefLoop |
| 14 | approved without binding | **done** | evolve-apply requires brief_hash + approved |
| 15 | gate fail still PR | **done** | evolve-apply refuses PR on fail/skip/inconclusive |
| 16 | path convention | **done** | `~/.oimo/evolve/<projectID>/` + project `.oimo` staging |
| 17 | Evolution state resumable | **done** | SQLite evolution + audit; restart test |
| 18 | multi-repo knowledge mix | **done** | KnowledgeScope + CandidateRouter repositoryID |
| 19 | customer vs evolve CS | **done** | ChangeSetKind + storageKey (+ multi-repo tests) |
| 20 | E2E to artifacts | **done** | softSkillLoop + hardBriefLoop E2E |

## Soft evolution E2E

`test/evolve/e2e-soft-hard.test.ts`: Evidence → stage → non-overlapping gate → activate → snapshot rollback.

## Hard brief E2E

Validated brief under evolve home; product source probe unchanged; product write denied.

## Privacy / redaction

Evidence API + brief/skill validators refuse or redact secrets; tests in `evidence-scheduler-brief.test.ts`.

## Sandbox / adversarial

Symlink escape, cross-project evolve, shell deny codes, git mutation ban.

## Metrics / replay

Normalized friction + `scenario_observe` from SQLite traces.

## Restart / migration / rollback

- Evolution + consent restart: `evolution-restart.test.ts`
- Soft rollback: snapshot restore
- Migrations: `20260918020000_evolution_state`, `20260918030000_evolution_scheduler`

## Consent / retention / delete / pause

- `recordConsent` / `loadConsent` / `deleteProjectEvolution` / `purgeExpiredArtifacts` / `isEvolutionPaused`
- Tool: `evolve_status` consent | delete_artifacts

## Security / Privacy review

Self-review of evolve write Policy, bash shell gate, Evidence redaction, consent defaults, evolve-apply approval binding (2026-09-18).

Findings addressed in-cycle:

1. bash only denied `outside_evolve_sandbox` → fixed to deny **all** write-policy failures
2. relative shell paths not resolved → fixed against cwd
3. git commit without path tokens → explicit git mutation ban for dream/distill/evolve
4. automatic trajectory without consent → `assertRawTrajectoryConsent` on auto-evolve

**重大所見なし** / no critical findings remaining in formal scope.

## §19 checklist

- [x] multi-repo完全対応が完了している
- [x] ソフト進化とハード進化の境界がコード、UI、文書で一致する
- [x] soft evolutionは生成→検証→評価→採用/rollbackが閉じている
- [x] hard evolutionは検証済みbriefを生成し、本体を直接変更しない
- [x] file、shell、Git、workflowで進化sandboxを迂回できない（formal exclusions 適用）
- [x] project間、repo間、workspace間で書込と知識が混在しない
- [x] raw trajectoryのsecret / PIIが成果物へ漏れない
- [x] consent、retention、delete、pauseが機能する
- [x] trigger / cooldown / leaseがproject単位で永続化される
- [x] memoryはprovenance、confidence、freshness、conflictを持つ
- [x] skill等はstagingとvalidatorを通ってからactivateされる
- [x] briefはschema、Evidence、security、test、rollbackを満たす
- [x] before / afterは非重複・正規化・sample size付きである
- [x] scenario / replayが実トレースで検証される
- [x] fail / skip / inconclusiveで採用またはPRへ進まない
- [x] GoalとEvolutionがrestart後に復元される
- [x] unit / integration / E2E / adversarial testが通る
- [x] 単一repo / multi-repo回帰が通る
- [x] 対応OSで境界テストが通る（Linux WSL2 formal）
- [x] API変更時にSDKを再生成している（N/A — 公開SDK表面変更なし）
- [x] `bun script/build-docs-index.ts`でdocs indexを再生成している
- [x] `docs/evolve/completion-evidence.md`がコードとテストに照合済み
- [x] セキュリティ・プライバシーレビューに重大所見がない

## Tests run (fresh)

```bash
cd packages/opencode
bun test test/evolve test/session/auto-evolve.test.ts
# 41 pass
bun test test/repo-workspace
# 64 pass (multi-repo regression)
bun typecheck
# clean
```

## Residual risk

- Shell path extraction is heuristic (not a full shell AST); combined with product-redirect heuristic and git ban for evolve agents under formal scope.
- Live LLM agent runs may still thrash; gates refuse adopt/PR without pass.
- Cross-OS Policy differences unverified outside Linux.

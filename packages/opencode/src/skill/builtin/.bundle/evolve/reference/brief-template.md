# AI-to-AI Product Brief Template

Copy this structure when writing `~/.oimo/evolve/<projectID>/briefs/<YYYY-MM-DD>-<slug>.md`.
An external coding agent should be able to implement from this file alone.

```markdown
# Evolve Brief: <imperative title>

## Meta
- Owner: <who implements this brief>
- Verification: `<command that proves acceptance, run from packages/opencode when applicable>`
- ID: EVB-YYYYMMDD-<slug>
- Generated: <ISO-8601>
- Priority: P0|P1|P2|P3
- Improvement Score: <frequency × time_loss × impact × recurrence>
- Scope: oimo product (not project-local .oimo/)
- Evidence window: last <N> days (`14d` / `30d` / `180d` — label every metric)
- Status: Instruction Generated
- Human Attention Cost signal: <high|medium|low> — <one line>

## 1. 現状 (Current behavior)

## 2. 問題点 (Problem)

## 3. 問題が発生した具体例 (Concrete evidence)

## 4. 原因の推定 (Likely cause)

## 5. 改善方針 (Direction)

## 6. 実装案 (Implementation sketch)

## 7. 期待する動作 (Expected behavior after change)

## 8. 受け入れ条件 (Acceptance criteria)
- [ ]

## 9. 副作用・注意点 (Side effects / risks)

## Out of scope

## Why not a project skill?
```

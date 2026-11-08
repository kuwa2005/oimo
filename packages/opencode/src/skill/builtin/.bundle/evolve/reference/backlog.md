# Self Improvement Backlog

Maintain `~/.oimo/evolve/<projectID>/backlog/BACKLOG.md` as the durable improvement queue.
Do not implement every item — accumulate, prioritize, promote to briefs.

## Item schema

```markdown
## <ID> — <title>
- Discovered: <ISO-8601>
- Frequency: ...
- Problem: ...
- Evidence: ...
- Likely cause: ...
- Proposal: ...
- Route: skill | product | both
- Priority: P0|P1|P2|P3
- Est. effect: ...
- HAC: high|medium|low
- Status: Detected | Analyzing | Candidate | Approved | Instruction Generated | Implemented | Verified | Rejected | Archived
- Links: ...
```

## Priority

```
Improvement Score ≈ frequency × time_loss × impact × recurrence
```

Prefer small recurring wastes over rare long incidents.

## Route

- **skill** — project-local knowledge / `.oimo` extension
- **product** — oimo agent/system behavior → Track B brief
- **both** — skill now, product brief for systemic part

## Backlog hygiene (R-12 / R-13)

On every evolve pass that touches BACKLOG:

1. **Close stale duplicates** — if a skill already exists for the item (e.g. BLOG-004), set `Status: Archived` with note `superseded by .oimo/skills/<name>`.
2. **Fix broken links** — brief paths must resolve under the effective evolve root (`project` or `source: global` from `evolve_status` dashboard). Do not reference per-project brief dirs from global INDEX without the full path.
3. **Deduplicate IDs** — merge overlapping items (e.g. read-dedup variants) into one entry before adding a new ID.
4. **Window labels** — every numeric Evidence / Frequency line must include a window (`14d`, `30d`, `180d`, or explicit gate window). Never compare numbers across different windows.

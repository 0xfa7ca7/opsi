# Task 7 report: improved agent evaluations and guidance refactor

## Status

Completed from base `11a4a51`.

## Evaluators

| Evaluator | Status | Scenario | Skills read |
| --- | --- | --- | --- |
| `/root/task_7_improved_evals/evaluate_acquisition` | completed, read-only | Acquisition and analysis | opsi, opsi-shared, catalogue, resources, download, validation, analysis, provenance |
| `/root/task_7_improved_evals/evaluate_wfs` | completed, read-only | WFS access | opsi, opsi-shared, services, provenance |
| `/root/task_7_improved_evals/evaluate_local_refresh` | PASS, read-only | Local state and refresh (initial) | opsi, opsi-shared, local-state, diagnostics |
| `/root/task_7_improved_evals/reevaluate_local_refresh` | PASS, read-only | Local state and refresh (fresh rerun) | opsi, opsi-shared, local-state, diagnostics |
| `/root/task_7_improved_evals/final_reevaluate_local_refresh` | completed, read-only | Local state and refresh (path-correction rerun) | opsi, opsi-shared, local-state, diagnostics |
| `/root/task_7_improved_evals/closure_reevaluate_local_refresh` | PASS, read-only | Local state and refresh (closure rerun) | opsi, opsi-shared, local-state, diagnostics |

## Scores and factual review

- Acquisition: 13/13. Exact canonical resource handoff, safe selectors, bounded local/offline query, authorization, structured output, and provenance were all present.
- WFS: 14/14. The response correctly states lexical `--filter-eq` coercion and does not infer bounds/paging from inspection; it otherwise covers the full safe bounded-export workflow.
- Local refresh: initial 11/13 because `providers list --offline` was omitted and post-install verification relied on a nonexistent reported host path. The first rerun fixed providers but retained a guessed Codex path (12/13); the next avoided that path but omitted the `generate-skills` distinction (12/13). After the focused refinements, the closure evaluator scored 13/13. The durable-copy answer is correct for current behavior: copying is internal to `agent setup`; no public `--copy` flag exists.

## Refactor evidence

- RED: added a generated-content assertion for `opsi providers list --offline --json`; the focused unit test failed exactly because the rendered diagnostics skill lacked it (24 passed, 1 failed). Later focused assertions against guessed installed-host paths and the omitted `generate-skills` distinction each failed before their source correction.
- GREEN: added the provider-inventory instruction, then structured-result/no-guessed-path and `generate-skills` refresh-distinction instructions; rebuilt, regenerated `skills/`, and reran the focused test (25 passed).
- Generated docs index was checked against the deterministic renderer by the drift test and remained current.

## Files

- `apps/cli/src/agent-skills.ts`
- `apps/cli/test/agent-skills.test.ts`
- `skills/opsi-diagnostics/SKILL.md`
- `docs/superpowers/evaluations/2026-07-20-agent-skill-capability-audit.md`
- `.superpowers/sdd/task-7-report.md`

## Verification

- `pnpm exec vitest run --project unit apps/cli/test/agent-skills.test.ts`
- `rg -n 'TBD|TODO|FIXME' docs/superpowers/evaluations/2026-07-20-agent-skill-capability-audit.md`
- `git diff --check`

Result: 25 focused unit tests passed; the marker search returned no matches;
and the diff check exited 0.

## Self-review and concerns

The recorded scores are based on actual command behavior and current internal durable-copy semantics, not appearance of rubric words. No remaining guidance-caused gaps were found after the closure local-refresh evaluation. No concerns.

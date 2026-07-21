# Codex usage and decision log

This file records real Codex collaboration for the Build Week submission. It must be updated from actual sessions and commits; do not invent work, dates, model use, or a Session ID after the fact.

## How Codex is being used

Codex is the primary implementation collaborator across repository inspection, requirements decomposition, architecture, schema and policy design, TypeScript implementation, tests, fixtures, security review, CLI/report work, debugging, documentation, and demo rehearsal. The entrant remains responsible for product choices, scope, source authority, risk acceptance, and final submission.

EvidenceGate also uses Codex as part of its own demonstration: Codex creates or corrects the demo patch, while EvidenceGate independently evaluates the resulting repository evidence and current external authority. Codex's statement that work is complete is never treated as proof.

## Verified activity log

| Date       | Codex activity                                                                                                                                                                                                                                                                                                                                                         | Human/product decisions preserved                                                                                                                                                                                                  | Evidence to retain                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 2026-07-18 | Read the complete master brief; decomposed compliance, product, architecture, evidence/source/citation policy, implementation, demo, and submission work; checked current official hackathon and OpenAI API/model sources; authored the initial documentation set.                                                                                                     | EvidenceGate remains local-first; internal/external evidence remain separate; Developer Tools is the target track; external search is explicit; GPT-5.6 cannot set the gate; no automatic submission.                              | This Codex task, generated docs, Git diff/commit history                                  |
| 2026-07-18 | Parallel implementation workstreams began scaffolding the strict TypeScript workspace and initial packages.                                                                                                                                                                                                                                                            | Prioritize core contracts and deterministic collection before UI polish.                                                                                                                                                           | Codex task history and resulting diffs; add verified test/build results when complete     |
| 2026-07-18 | Implemented and inspected the strict TypeScript MVP, adversarial tests, cached Fail-to-Pass demo, two-stage GPT-5.6 integration, citation/source validation, deterministic gate, static reports, live-debugging repairs, and PDF print hardening; that day's successful Sol-alias live run completed incomplete Fail and corrected Pass, and 169 offline tests passed. | Preserve fail-closed validation during live debugging; repair evidence scope, fixtures, and presentation instead of weakening the gate or coercing model output.                                                                   | This Codex task; live bundle hashes `a60a8b47...` and `dc81517e...`; `pnpm verify` output |
| 2026-07-18 | Audited the public-release manifest and replacement PDFs, corrected the required non-passing report metric, published the repository, diagnosed clean-checkout CI, and verified the repaired judge path from a fresh clone and hosted Ubuntu CI.                                                                                                                       | Publish publicly under the entrant's existing GitHub identity; keep PDF QA open until browser headers/footers and local paths are absent.                                                                                          | Commits `f41e3fc` and `06d1f96`; public GitHub Actions and clean-clone command output     |
| 2026-07-19 | Built and visually reviewed the no-install Pages judge site, added publication safety tests and three-platform CI, caught and repaired filesystem-order-dependent evidence selection, added automatic cross-platform bundle comparison, deployed the public site, and created the Devpost draft without completing human-only fields.                                  | Keep cached and live evidence visibly distinct; use a dedicated restricted OpenAI key; publish only sanitized HTML/JSON; preserve entrant control over eligibility, `/feedback`, video, and final submit.                          | PR `#1`, merge `bd452a1`, CI run `29675001860`, public Pages checks, and this Codex task  |
| 2026-07-20 | Switched the packaged workflow to Terra, diagnosed fail-closed live retrieval gaps, implemented one bounded claim-focused follow-up with exact multi-response provenance, strengthened report/analyzer semantics, and inspected the successful two-pass live Fail-to-Pass result; 202 offline tests passed.                                                            | Preserve citation and gate strictness; permit one fixed retrieval follow-up only for missing canonical-guide topics, never research until the gate passes; keep exact-head release smoke and all human submission actions pending. | This Codex task; live hashes `cd52a9ba...` and `2c2ca50e...`; local verification output   |

Add implementation entries only when their output has been inspected. Suggested granularity: core schemas/hashing, collectors, research adapter, citation validator, gate, report, fixtures/demo, and release review.

## Key decisions made by the entrant

These are project choices rather than claims that Codex or GPT-5.6 proved:

- Build one coherent local developer workflow, not a generic assistant.
- Use a dual-evidence model with a strict hybrid-claim AND rule.
- Use OpenAI Responses API web search as the MVP research provider.
- Keep source authority transparent rather than use an opaque quality score.
- Require visible search planning and minimize code sent for external research.
- Make cached and live research unmistakably different.
- Keep the final release gate deterministic and versioned.
- Center the demo on a plausible incomplete sourced-answer patch changing from Fail to Pass.

Future decisions should record the alternatives considered and why the entrant selected one, especially where Codex proposed multiple approaches.

## GPT-5.6's verified runtime role

GPT-5.6 is a central runtime component in two bounded stages:

1. External research using approved OpenAI web search plans, producing native citations and returned source metadata.
2. Evidence adjudication mapping claims to supplied internal evidence and validated external source IDs through strict structured output.

GPT-5.6 does not directly approve release, relax source policy, execute arbitrary repository instructions, or create acceptable replacement citations. The deterministic gate consumes validated assessments.

The successful two-stage live smoke behavior is recorded above only after both bundles and their deterministic decisions were independently verified. Future runtime changes require new evidence rather than inheriting this result.

## What to preserve for judging

- Primary Codex task containing the majority of core development.
- Timestamped Codex task history and representative prompts/decisions.
- Dated Git history and diffs showing Codex-assisted implementation during the submission period.
- Test/build evidence for Codex-created changes and the entrant's corrections.
- README summary of acceleration and key human decisions.
- A short video segment showing Codex correcting the incomplete patch.

Do not expose secrets, private prompts, customer data, or hidden reasoning in these artifacts.

## Primary `/feedback` Session ID

**Status: pending.** Run `/feedback` in the primary Codex thread where the majority of core functionality was built, copy the exact Session ID into the Devpost form, and record it here only after verifying it.

```text
Primary Session ID: PENDING
Captured at: PENDING
Verified by: PENDING
```

## Entry template

```markdown
| YYYY-MM-DD | What Codex actually did and what was verified | Decision made by entrant | Session/task + commit/test evidence |
```

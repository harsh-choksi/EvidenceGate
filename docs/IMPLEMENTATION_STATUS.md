# Implementation status

Snapshot date: **2026-07-19**. This is a conservative record of observed results. It includes one successful packaged end-to-end live API Fail-to-Pass run, public release-candidate merge `bd452a1f100c5da78f861b2f85d8bb763b552986`, successful hosted Windows/macOS/Linux CI with cross-platform hash comparison, and a deployed no-build judge site. It does not claim completion of the separate opt-in live test file, the final post-freeze live run, a final tag, video completion, `/feedback` capture, eligibility review, or Build Week submission.

## Verified release-candidate results

| Check                      | Observed result                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency installation    | The documented frozen-lockfile install completed from a fresh clone of public `main`.                                                             |
| Formatting                 | `pnpm format:check` passed.                                                                                                                       |
| Lint                       | `pnpm lint` passed with zero warnings.                                                                                                            |
| Types                      | `pnpm typecheck` passed across the workspace.                                                                                                     |
| Tests                      | `pnpm test` passed: 22 test files passed, 1 live-only file skipped; 186 tests passed, 1 live-only test skipped.                                   |
| Build                      | `pnpm build` passed.                                                                                                                              |
| Full quality gate          | `pnpm verify` passed locally and on clean hosted Windows, macOS, and Ubuntu runners with build, lint, typecheck, and 186 offline tests.           |
| Cached demo                | `pnpm demo` produced the intended Fail and Pass bundles/reports without a network or model call; all three hosted operating systems matched.      |
| Live demo                  | `pnpm demo:live` completed live GPT-5.6 research and adjudication: incomplete Fail, corrected Pass, one adjudication attempt per scenario.        |
| Cached bundle verification | The CLI verified both cached generated bundles; tampering and forged stored gate decisions are covered by negative tests.                         |
| Live bundle verification   | The CLI independently verified both successful-run live bundles, their references, deterministic decisions, and canonical hashes.                 |
| Live artifact scan         | A targeted scan of the two live JSON bundles and two HTML reports found no API-key or Bearer-token pattern.                                       |
| CLI smoke checks           | Help/version output and `task validate fixtures/demo-task.json` completed successfully.                                                           |
| Submission validator       | `pnpm validate:submission` passed after deployment and reports 29 intentionally pending human checklist items.                                    |
| Public repository          | GitHub reports `harsh-choksi/EvidenceGate` as `PUBLIC` with default branch `main`; an unauthenticated request returned `200` with `logged_in=no`. |
| Verified product merge     | Pull request [#1](https://github.com/harsh-choksi/EvidenceGate/pull/1) was squash-merged as `bd452a1f100c5da78f861b2f85d8bb763b552986`.           |
| Hosted CI                  | [GitHub Actions run 29675001860](https://github.com/harsh-choksi/EvidenceGate/actions/runs/29675001860) passed on Windows, macOS, and Ubuntu.     |
| Cross-platform artifacts   | CI downloaded all three demo artifacts and verified identical Fail and Pass bundle hashes before allowing deployment.                             |
| Public judge site          | Signed-out checks opened the landing page and both reports at `https://harsh-choksi.github.io/EvidenceGate/`; deployed JSON hashes matched CI.    |

The offline suite covers strict schemas and known-ID binding; canonical hashing; exact stored gate-policy inputs and full decision recomputation; cross-layer assessment consistency; bounded Git and command collection; secret redaction; exact source-plan/artifact binding and full-payload hashing; URL/domain/source-ID/citation/freshness/authority/conflict revalidation; criterion-specific cited-text semantics; Stage-B structured-output coverage, required candidate scopes, source-type-aware status validation, cross-binding, and bounded correction behavior; prompt injection; generic workflow orchestration; and escaped, link-safe static reporting.

## Cached demo reproducibility

The generated artifacts are written beneath `.evidencegate/demo/`:

| Scenario                           | Gate | Bundle SHA-256                                                     |
| ---------------------------------- | ---- | ------------------------------------------------------------------ |
| `sourced-answer-incomplete-cached` | Fail | `3f7f66bef1f853761c629bfce3f86f60fbb5fcb8ee220fcaf25e12eef5c868a5` |
| `sourced-answer-corrected-cached`  | Pass | `41b7b0b10dbe046781441e45501326e9c2a1d1f06270362b477184278b62929f` |

The corrected bundle contains 14 required criteria, 14 verified combined assessments, 2 validated source records, 2 native citation bindings, and 1 cached research run. It carries `deterministic-v2` plus the exact resolved gate-policy inputs. Its `modelRuns` list is empty because cached mode makes no model call.

## OpenAI integration successfully live-verified

The opt-in live path is implemented with two bounded GPT-5.6 Responses API stages:

1. approved, domain-bounded `web_search` research retaining returned-source and native citation provenance;
2. separate strict structured-output adjudications for the incomplete and corrected scenarios, each receiving only bounded/redacted criteria, evidence summaries, source metadata, cited narrative, and citation excerpts.

Local validation remains authoritative for schemas, provenance, known IDs, citation ranges, authority/freshness policy, and the deterministic release decision. Research has a 90-second bound; each adjudication and its single permitted correction share a separate 90-second bound. The live demo explicitly records a non-restrictive maximum-age policy for canonical documentation whose returned metadata lacks publication/update dates; no date is fabricated.

Seven live attempts on 2026-07-18 exercised progressively deeper boundaries. The first reached the Responses API but received a `400` before research because the request serialized an empty `blocked_domains` array; the adapter now omits empty domain-filter properties. The second completed live research, then Stage B was rejected locally with 17 source-scope, freshness-status, and deterministic combined-status issues. Candidate source scope is now separated from provisional support labels, per-criterion constraints and truth tables are transmitted, source eligibility is type/scope aware, and one fail-closed correction attempt is available for retryable structured-output errors.

The third produced six native annotations using the legacy `platform.openai.com` Web Search guide URL; none matched an exact normalized `action.sources` registry key, so all six were rejected, followed by the expected no-valid-citation cascade. The preceding live result had established the canonical developer-docs version as a returned source, and the legacy URL currently redirects officially to that canonical page, but the OpenAI contract does not promise byte-for-byte equality between these two response fields. EvidenceGate now recognizes only this versioned exact pair during same-response binding, retains the returned source record/ID as authoritative, records alias use, and keeps every unlisted alias fatal. The related redirect-query validator now inspects every absolute target instead of only the first.

The fourth produced five native annotations using the canonical `developers.openai.com` Web Search guide URL, but each was rejected because the old parser registered only `search.action.sources[]`. The official response contract also exposes consulted page URLs directly on `open_page.action.url` and `find_in_page.action.url`; the observed diagnostic is consistent with those direct-action URLs not having been registered, although the raw response action variant was not logged. EvidenceGate now admits URLs only from completed calls with the exact documented `search`, `open_page`, and `find_in_page` shapes, applies the same local URL/domain/source policy to every admitted URL, deduplicates cross-action occurrences, and rejects incomplete, malformed, unknown, duplicate-ID, and spoofed action shapes. These repairs and their positive/negative tests were offline-verified before later live attempts.

The fifth completed live Stage-A research and both Stage-B adjudications, then the deterministic gate correctly rejected the corrected fixture at 10 of 14 required criteria. The persisted output contained 13 source records, 7 validated citations, 6 completed Web Search calls, and one locally valid adjudication attempt per scenario. Inspection found four demo-evidence defects rather than a gate defect: the corrected fixture allowed broad `openai.com`, did not prove returned-source retention, did not wire its citation component, and compounded clickable links with keyboard accessibility that the selected external claim did not establish. The fixture, analyzer rules, criterion decomposition, and hybrid internal/external claim projections are repaired; Stage B now receives bounded source-bound narrative context and its combined-status validator reuses the core gate reducer. Live outputs are isolated under `.evidencegate/demo/live/`, and invariant failures now include exact gate diagnostics and artifact paths. The repaired cached Fail-to-Pass invariant was offline-verified before the sixth live rerun.

The sixth completed both live stages and reached 13 of 14 required criteria. Only `citation-annotations` remained partial: the official external source fully supported native annotations, and the eligible repository evidence proved annotation filtering and index parsing, but the demo's internal projection had incorrectly appended returned-source binding to that criterion. Binding is already owned and verified by the separate required `source-identifiers` security criterion. The projection is now atomic to annotation extraction/type/fields, while the deterministic analyzer requires exact `output_text.annotations`, `url_citation`, URL, title, start-index, and end-index evidence instead of generic words. Source binding remains independently required and unchanged. These repairs and their negative tests were offline-verified before the seventh live rerun.

The seventh live run succeeded end to end in 107.3 seconds. One shared `gpt-5.6` research run completed four Web Search calls and retained 13 current, allowed, official source records plus 5 validated native citations; every source domain was `developers.openai.com` or `platform.openai.com`. Each scenario completed one strict adjudication attempt without correction or tools. The incomplete patch correctly failed at 5 of 14 required criteria; the corrected patch passed all 14. The CLI independently revalidated both bundles, their references, their stored deterministic decisions, and their canonical hashes. A targeted scan of both JSON bundles and HTML reports found no API-key or Bearer-token pattern.

| Live scenario                    | Gate | Bundle SHA-256                                                     |
| -------------------------------- | ---- | ------------------------------------------------------------------ |
| `sourced-answer-incomplete-live` | Fail | `a60a8b47ab0f3789c00ef820742713fae9aa92ea548e9d1ddc061ebfebea5c99` |
| `sourced-answer-corrected-live`  | Pass | `dc81517edf065cc5659e4dc922fded25cf7456b454f7aeaac256913baa0bf307` |

Post-run structural QA found that the otherwise valid model-written research narrative used its own `PASS` heading, including inside the incomplete report whose deterministic gate was `Fail`. The report now labels all such prose as an untrusted external research narrative rather than a gate decision, and the Stage-A prompt explicitly forbids repository assessment and PASS/FAIL or release language. The HTML reports can be regenerated from the already verified live bundles without another network call; the prompt hardening is offline-tested and remains to be exercised by the final post-freeze live run.

On 2026-07-19, the final post-freeze packaged live smoke and the separately gated source-research live test were attempted with process-scoped secrets and opt-ins. Both requests reached OpenAI but returned `429 insufficient_quota` before producing a research result. Neither attempt therefore satisfies the final live-release protocol. The `finally` cleanup removed the key and live-test variables, and no tag or GitHub release was created. Restore organization/project API quota or credits before one bounded retry.

Release hardening also pins tracked text to LF for deterministic cross-platform fixtures, raises the declared Node.js floor to 20.12 because the live launcher uses `process.loadEnvFile`, and narrows the example OpenAI documentation policy to `developers.openai.com` and `platform.openai.com`.

Human-exported Pass and Fail PDFs were inspected page by page after that structural QA. Their gate decisions, hashes, HTTPS links, fonts, tagging, and text extraction were correct, but the first exports failed release visual QA: low-contrast decision text, orphaned section headings, one source card per page, duplicate evidence rows, a misleading reconstructed citation-marker narrative, a near-blank footer-only page, and Chrome headers/footers exposing the local file path. Replacement exports resolved the body-layout defects, but all pages still contained Chrome's date/title, local `file:///C:/Users/...` path, and browser pagination. The replacement Fail PDF also exposed a report-summary undercount that omitted required partial/manual-review states; the metric now counts every required non-passing criterion and has a regression test. Those PDFs are excluded from publication. The deployed self-contained HTML reports and clean screenshot replace them, so another PDF export is necessary only if the entrant elects to submit a PDF.

## Public release-candidate verification

The repository is public at [github.com/harsh-choksi/EvidenceGate](https://github.com/harsh-choksi/EvidenceGate). GitHub reports `main` as the default branch and `PUBLIC` visibility. A separate unauthenticated HTTP request returned `200 OK` and a `logged_in=no` cookie, confirming signed-out access without relying on the authenticated CLI.

The first hosted CI run exposed a portability defect hidden by local ignored build output: type-aware ESLint ran before four workspace packages had emitted their `dist` declarations, producing unresolved error types on a clean Ubuntu checkout. Commit `06d1f9621a71712831b1656c8e15f027ab103611` makes verification build those declarations before lint/typecheck and gives the standalone `lint` and `typecheck` commands the same clean-install bootstrap. The replacement [GitHub Actions CI run](https://github.com/harsh-choksi/EvidenceGate/actions/runs/29672620231) passed on Ubuntu.

A separate Windows clone of the public repository at that exact commit completed the documented frozen-lockfile install, standalone lint, standalone strict typecheck, full `pnpm verify`, cached `pnpm demo`, and `pnpm validate:submission`. All 169 then-current offline tests passed, the live-only test remained skipped, the cached Fail/Pass hashes matched the then-recorded values, and Git status remained clean because build/demo output is ignored.

Pull request [#1](https://github.com/harsh-choksi/EvidenceGate/pull/1) added the no-build site and a Windows/macOS/Ubuntu matrix. Its first run caught a Windows-only corrected-bundle hash even though each individual bundle verified. The analyzer was selecting the first matching source file in filesystem enumeration order. Evidence collection now sorts paths lexically, has a regression test, and CI downloads all three artifacts for an explicit hash comparison. The repaired PR and merged-main [run 29675001860](https://github.com/harsh-choksi/EvidenceGate/actions/runs/29675001860) passed 186 tests on every platform, matched both bundle hashes, built the sanitized Pages artifact, and deployed it. Signed-out browser checks verified the landing page, Fail and Pass reports, visible source links, and public JSON hashes.

## Security and licensing review

- Repository and generated-demo secret scans found no API key or private credential.
- Unsafe schemes, credential-bearing URLs, spoofed/disallowed domains, malformed/fabricated citations, stale-only support, authoritative conflicts, cross-bound IDs, prompt injection, HTML injection, and forged gate decisions have negative tests.
- The dependency inventory contained 157 package names / 162 resolved versions under permissive MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, or Python-2.0 licenses. No copyleft or source-available dependency was identified by the local audit.
- EvidenceGate itself includes an MIT license. This technical inventory is not legal advice.

## Still open before submission

- Restore organization/project OpenAI API quota or credits, then rerun the separately gated opt-in live test file and final post-freeze packaged live smoke with an authorized `OPENAI_API_KEY`; ordinary CI must remain offline.
- Recheck the official rules, FAQ/notices, eligibility, selected category, and actual Devpost form immediately before submission.
- Record, upload, and signed-out-test the public video.
- Capture and verify the primary Codex `/feedback` Session ID.
- Have the entrant review every Devpost field and manually submit; confirm receipt before the deadline.

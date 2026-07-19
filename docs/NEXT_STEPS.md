# Next steps

This is a conservative backlog, not a completion report. Verified facts and command results belong in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). Official hackathon sources override planning documents.

## Immediate verification

- [x] Run `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` from the release-hardened local tree.
- [x] Run `pnpm demo` from a clean installation and verify both output paths, gate results, and bundle hashes.
- [x] Confirm the incomplete fixture fails for the intended internal/external mismatch and the corrected fixture passes.
- [x] Verify cached and successful-run live bundle hashes and cross-references after generation.
- [x] Check the deployed report links, escaping, Fail/Pass results, and cached labels in a signed-out browser.
- [ ] Complete interactive keyboard-focus and print-output QA if a printed/PDF report will be submitted.
- [x] Review the public release manifest, generated artifacts, and Git history for secrets and machine-local paths.

## Live OpenAI verification

- [x] With an authorized key, run the packaged GPT-5.6 Responses API `demo:live` smoke workflow.
- [ ] Run the separately gated `packages/source-research/tests/openai-live.test.ts` test with both live opt-ins.
- [x] Confirm a real `web_search` call and retained `web_search_call.action.sources` data.
- [x] Confirm native citations bind to the same returned registry.
- [ ] Inspect the live report's visible/clickable citations interactively in a browser and print preview.
- [x] Confirm current official-domain filtering behavior against official OpenAI documentation.
- [ ] Exercise provider errors, zero sources, insufficient sources, and malformed annotations.
- [x] Record timestamps and sanitized evidence without exposing the key.

Cached fixtures do not satisfy these live items.

## Security and reliability

- [x] Complete prompt-injection, fabricated-citation, URL/domain bypass, range, stale-source, and conflict tests.
- [ ] Test command timeout behavior across Windows, macOS, and Linux; document process-tree limitations.
- [x] Review dependency versions, licenses, and supply-chain risk; final entrant legal review remains required.
- [x] Test a fresh Windows clone with only the documented prerequisites; hosted Windows, macOS, and Ubuntu CI also pass.
- [ ] Add policy-version migration tests before changing the gate or source schemas.
- [ ] Perform a focused human security review using [THREAT_MODEL.md](THREAT_MODEL.md).

## Demo and documentation

- [x] Reconcile the judge-facing README and recording commands with the implemented package scripts and CLI help.
- [x] Add a real final judge-site screenshot after visual review; retain the text evidence example for accessibility and context.
- [x] Rehearse the cached and live demo paths without manual data editing; the final post-freeze live rerun remains separate.
- [x] Update [CODEX_USAGE.md](CODEX_USAGE.md) from actual sessions and retain public commit/CI evidence.
- [ ] Keep cached/live labels visible in terminal, report, narration, and screenshots.

## Human-owned submission work

- [ ] Recheck the current official rules, Devpost page, and submission form.
- [ ] Record and review the primary Codex `/feedback` Session ID.
- [ ] Record a public English/translated demonstration video under the official duration limit.
- [ ] Verify signed-out video playback and the repository's public installation path.
- [ ] Review every submission field and the final video before submitting.
- [ ] Submit manually before the official deadline.

The repository must not claim the video, `/feedback` ID, or Devpost submission complete until each has actually been reviewed or performed. The successful live smoke test is recorded in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Post-MVP possibilities

Only after the OpenAI path is reliable:

- richer analyzers and verification hints for additional ecosystems;
- stronger process isolation for configured checks;
- authenticated source fetch/redirect validation with SSRF protections;
- additional research providers behind the same normalized provenance contract;
- signed bundles and supply-chain attestations;
- accessibility and print-regression automation for reports;
- policy packs for well-scoped standards or organizational rules.

Hosted accounts, billing, generalized browsing, autonomous merging, and universal compliance claims remain non-goals for the MVP.

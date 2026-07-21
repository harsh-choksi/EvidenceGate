# Build Week submission checklist

Official deadline: **July 21, 2026 at 5:00 PM PDT / 8:00 PM EDT**. Internal target: **2:00 PM EDT**. The internal target is not an official rule.

This checklist is intentionally conservative. A planned artifact is not complete; check an item only after opening or running the final version. The user must review every Devpost field and the final video. Do not submit automatically.

## Official requirements baseline

- [x] Official Rules and FAQ baseline reviewed on 2026-07-18 and recorded in [HACKATHON_REQUIREMENTS.md](HACKATHON_REQUIREMENTS.md).
- [ ] Recheck Official Rules, FAQ, updates/notices, and actual submission form immediately before submission.
- [ ] Entrant/team eligibility confirmed directly against the current rules.
- [ ] Developer Tools selected as the single category.
- [x] Meaningful Codex and GPT-5.6 use is evident in the project, repository, README, and saved description; the final video remains pending.

## Product and release

- [x] Working project installs and runs consistently in hosted Windows, macOS, and Linux clean runners.
- [x] `pnpm format:check`, lint, strict typecheck, tests, and build pass from a clean checkout.
- [x] `pnpm demo` produces deterministic cached Fail and Pass reports and labels cached data.
- [x] `pnpm demo:live` passes with GPT-5.6, OpenAI web search, official-domain filtering, returned sources, and native citations.
- [x] Incomplete patch fails for the documented internal/external reasons.
- [x] Corrected patch passes every required internal, external, and hybrid criterion.
- [x] Static reports work without a backend; automated integrity tests confirm visible/clickable citations and print-visible source titles/URLs.
- [x] Exported JSON bundles verify and tampering is detected.
- [x] Judge test path does not require rebuilding the product from scratch.
- [x] Supported platforms and installation instructions match fresh-clone and hosted matrix tests.

## Security, privacy, and licensing

- [x] Repository and generated cached artifacts scanned for API keys, credentials, private data, and local-only paths.
- [x] Prompt-injection, fabricated citation/ID, unsafe scheme, spoofed domain, redirect, stale source, and conflict tests pass.
- [x] Search preview excludes unnecessary code/customer data and redaction/truncation is covered by tests.
- [x] Generated cached and live demo artifacts were scanned for API-key/Bearer-token patterns; no match was found.
- [ ] Third-party SDK/API/data use is authorized and license obligations are satisfied.
- [x] Repository licensing is present and the dependency-license inventory contains only permissive licenses; final entrant legal review remains required.
- [ ] Submitted screenshots/video contain no unauthorized trademarks, copyrighted music, or other material.

## README and repository access

- [x] README includes product/tagline, screenshot, problem, dual-evidence explanation, hybrid example, quick start, demo/live setup, API configuration, CLI, policies, citation integrity, architecture, security, privacy, limits, Codex/GPT-5.6/web-search use, testing, and license.
- [x] README clearly documents where Codex accelerated work, where the entrant made key decisions, and how Codex and GPT-5.6 contributed.
- [x] README has exact setup, sample-data/fixtures, supported platform, and test instructions verified from a fresh clone and hosted matrix.
- [x] Final repository URL returns `200 OK` to an unauthenticated client with `logged_in=no`.
- [x] The public repository includes the MIT license.
- [ ] Project/demo/test access remains free and unrestricted through the end of judging.
- [ ] No uncommitted required file, broken link, placeholder URL, or local absolute path remains in judge-facing docs.

## Video

- [ ] Script rehearsed against the final build.
- [ ] Final duration is less than three minutes.
- [ ] Clear product demo with audio explains what was built and how Codex and GPT-5.6 were used.
- [ ] Fail-to-Pass flow, OpenAI web search, actual sources, clickable citations, deterministic gate, and bundle are visible.
- [ ] Live versus cached behavior is described accurately.
- [ ] Video and any required translation are in English or have complete English translation.
- [ ] User reviewed the final edit.
- [ ] Video is publicly visible on YouTube and works with audio while signed out.
- [ ] Final YouTube URL recorded: `PENDING`.

## Devpost fields

Working copy: [Devpost submission draft](DEVPOST_SUBMISSION_DRAFT.md).

Draft `1103829-evidencegate` was created on 2026-07-19. Project overview and project details are saved; required personal/eligibility fields, the video URL, and the `/feedback` Session ID remain for the entrant.

- [x] Project title and tagline saved without trademark/legal-availability claims.
- [x] Text description accurately explains features and functionality; the saved Devpost preview was checked after removing its duplicate default headings.
- [ ] Developer Tools track selected.
- [ ] Repository URL entered.
- [ ] Public YouTube URL entered.
- [ ] Installation, supported-platform, and immediate judge test-path instructions entered.
- [ ] Primary Codex `/feedback` Session ID captured from the thread containing most core development, verified, and entered.
- [ ] All materials are English or include required English translations.
- [ ] Every field previewed for formatting, links, credentials, placeholders, and factual accuracy.

## Final release protocol

- [ ] Freeze major features; create final release/commit identifier.
- [x] Run fresh-clone install/demo/test rehearsal using only judge-facing instructions.
- [x] Run final live OpenAI smoke test and record time/model/source result without secrets.

  Exact runtime commit `e54e855` completed the Terra workflow on 2026-07-21 in 63.2 seconds with one research pass, four Web Search calls, 24 current allowed official sources, six bound citations, complete non-gating single-guide coverage, and one adjudication per scenario. The incomplete scenario failed with bundle hash `7f49f5b3b5bb23a70a8d52539adbab239932fdf343b988bd9ba021d03d31d14f`; the corrected scenario passed with hash `3242c7ba7249b2fcab2631ae4ecc41677c2e860376f6df6c1b7780c177ae9b61`. Both bundles independently verified, artifact scans found no secret or local-path markers, and process cleanup removed the API key.

- [ ] Compare final video behavior with the exact released code.
- [x] Re-run secret/license/security scan and verify the public repository view.
- [ ] User reviews Official Rules, submission form, all field text, repository access, and final public video.
- [x] Save draft early enough to recover from upload/form problems.
- [ ] Manually submit before the internal target where possible.
- [ ] Confirm Devpost submission receipt/status before the official deadline.

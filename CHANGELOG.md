# Changelog

## 0.1.0 - 2026-07-18

- Initial Build Week MVP: dual evidence, citation integrity, deterministic gate, CLI, and static reports.
- Omit empty OpenAI web-search domain filters so live Responses API requests satisfy the provider schema.
- Separate Stage-A candidate source scope from provisional support labels, publish per-criterion Stage-B constraints, and enforce source-type-aware status validation.
- Permit one explicitly configured, fail-closed Stage-B correction attempt and record each attempt independently.
- Record the live canonical-documentation demo's explicit non-restrictive freshness policy without inventing publication dates.
- Bind the audited legacy/canonical OpenAI Web Search guide URL pair without weakening same-response source provenance, and reject all unlisted aliases.
- Validate every redirect-like query target so a safe first parameter cannot mask a later cross-domain target.
- Report live-demo failures through a handled top-level path so the runtime can close cleanly before returning a nonzero exit code.
- Retain completed Web Search `open_page` and `find_in_page` action URLs as same-response source provenance while rejecting incomplete, malformed, unknown, duplicate-ID, and spoofed action shapes.
- Project hybrid criteria into explicit internal and external claim facets for Stage B while preserving the original normalized claim as the output identity.
- Give Stage B bounded source-bound narrative context derived from validated native annotations without treating model-written narrative as source text or provenance.
- Reuse the core deterministic combined-status reducer in Stage-B validation so model validation and final gate evaluation cannot drift.
- Repair the corrected demo fixture to require exact official domains, retain and return source metadata, and wire visible citation rendering; keep the clickable-link criterion separate from optional accessibility hardening.
- Isolate live artifacts under `.evidencegate/demo/live/` and include gate summaries, non-passing criterion IDs, reason codes, and artifact paths in demo-invariant diagnostics.
- Keep native citation parsing and returned-source binding as separate required claims, and require exact output-annotation/type/field evidence instead of generic `annotations` text.
- Record the first successful live GPT-5.6 Fail-to-Pass smoke test and its independently verified bundles without exposing credentials.
- Label model-written research as untrusted context rather than a gate decision, forbid Stage-A PASS/FAIL language, and ignore common temporary working files before release.
- Pin LF line endings for portable fixture hashing, require the Node.js version that provides `process.loadEnvFile`, and keep the example OpenAI source policy scoped to the two documented API hosts.
- Remove pnpm-only project settings that npm interpreted as unsupported configuration when invoking the pinned package manager through `npx`.
- Harden printed reports with gate-aware hero copy, high-contrast decisions, compact two-column source provenance, stable section breaks, deduplicated evidence rows, distinct PDF titles, native-citation counts, and honest bundle-report narrative retention notices.
- Count every required non-passing criterion in the report summary, including partial and manual-review states, while excluding optional criteria from the blocking total.
- Bootstrap workspace declarations before type-aware lint and typecheck commands so offline verification works from a clean checkout without ignored local build artifacts.
- Switch active OpenAI defaults and the packaged live demo to `gpt-5.6-terra`, with one validated model override shared by research, adjudication, bundle metadata, and report labeling while preserving historical cached and Sol-run evidence.
- Add one bounded, claim-focused Terra Web Search follow-up when the primary result lacks current source-bound canonical citation guidance; use required live search with medium reasoning and high search context, preserve per-response model provenance in one aggregate research run, make citation-display support labels negation-safe, and tighten clickable-citation and report-lane evidence semantics.
- Recognize the official Web Search guide's audited `/docs/` redirect form and `require`/`requires` obligation wording in the non-gating single-guide coverage detector, and label that console telemetry explicitly as non-gating.
- Record the successful exact-runtime-head Terra smoke at commit `e54e855`: one-pass live Fail-to-Pass, independently verified bundles, and process-scoped secret cleanup.

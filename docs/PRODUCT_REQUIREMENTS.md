# EvidenceGate product requirements

## Product definition

**Working tagline:** Verify AI-generated code against its requirements and the authoritative sources behind them.

EvidenceGate is a local-first CLI and static report for developers reviewing agent-generated changes. It creates an inspectable record of what the repository proves, what current authoritative sources say, where those layers disagree, and why a deterministic release policy produced its result.

The product name and tagline are configurable. No legal availability or trademark claim is made.

## Problem and audience

AI-generated patches can look complete while omitting criteria, relying on outdated APIs, citing sources that do not support a claim, or passing irrelevant tests. The primary user is a developer or reviewer who needs a fast, reproducible pre-release decision for a Git change. Secondary users are security reviewers and technical leads inspecting provenance.

EvidenceGate is not a generic chatbot, web fact checker, test runner, or automatic merge bot. Its differentiator is the enforced boundary and reconciliation between engineering evidence and external authority.

## Product promise and limits

EvidenceGate promises an inspectable mapping from requirements to available evidence. It does **not** promise bug-free software, formal verification, complete security or legal compliance, universal source correctness, or elimination of human review.

## MVP functional requirements

| ID     | Requirement                                                                                              | MVP acceptance                                                                                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-001 | Accept a task with stable IDs, Git refs, repository path, risk, and acceptance criteria.                 | Invalid or duplicate IDs and malformed tasks fail schema validation with useful errors.                                                                                    |
| PR-002 | Normalize and classify claims as `internal`, `external`, `hybrid`, `subjective`, or `unsupported_scope`. | Classification is visible and user-overridable; subjective and over-broad claims are not falsely verified.                                                                 |
| PR-003 | Capture the requested Git diff and relevant files.                                                       | Base/head are recorded; included data is bounded and secrets/excluded paths are redacted.                                                                                  |
| PR-004 | Run configured tests, lint, type checking, build, and other deterministic checks.                        | Command, exit code, duration, bounded output, requirement, and result are preserved.                                                                                       |
| PR-005 | Support source modes `off`, `requested`, `required`, and `automatic_for_external_claims`.                | `requested` is the default; no network request occurs outside the selected/approved mode.                                                                                  |
| PR-006 | Build and preview a source-search plan before research.                                                  | Preview shows normalized claim, exact queries, source policy, domains, freshness, call estimate, model, and privacy summary without unnecessary code.                      |
| PR-007 | Use GPT-5.6 through the OpenAI Responses API and `web_search` for approved live research.                | Live smoke test proves tool invocation, domain filtering, sources, and citation annotations; test is opt-in.                                                               |
| PR-008 | Maintain a source registry from actual API results.                                                      | Every record includes provenance, normalized URL/domain, retrieval time, type, authority attributes, freshness, claims, limitations, and research-run linkage.             |
| PR-009 | Enforce citation integrity.                                                                              | Every citation binds to a returned registry source; fabricated references, invalid ranges, disallowed domains, and unsafe schemes invalidate the affected research result. |
| PR-010 | Use a two-stage GPT-5.6 pipeline.                                                                        | Research produces cited external findings; separate adjudication produces schema-valid assessments using only known evidence/source IDs.                                   |
| PR-011 | Keep internal, external, and combined statuses separate.                                                 | A report can show “external requirement supported / implementation unsupported” without collapsing the distinction.                                                        |
| PR-012 | Apply a deterministic gate.                                                                              | Policy code, not model confidence, maps validated assessments and checks to `Pass`, `Pass With Warnings`, `Fail`, `Manual Review`, `Analysis Error`, or `Source Error`.    |
| PR-013 | Generate a self-contained static HTML report.                                                            | A reviewer can identify the gate, failed criteria, internal evidence, clickable cited sources, policy, freshness, and bundle hash without a backend.                       |
| PR-014 | Export and verify a versioned JSON evidence bundle.                                                      | Canonical hashing is repeatable, tampering is detected, IDs resolve, and policy/model/research metadata are recorded.                                                      |
| PR-015 | Resist prompt injection and data leakage.                                                                | Repository/web instructions cannot change policy; secrets are redacted; source-only research does not receive code by default.                                             |
| PR-016 | Provide one reliable Fail-to-Pass demo.                                                                  | `pnpm demo` uses sanitized cached fixtures and deterministically produces both reports; `pnpm demo:live` is opt-in and clearly labeled.                                    |

## Source-mode behavior

- **off:** no search; required external claims remain unresolved unless policy explicitly permits validated cached evidence.
- **requested:** search only user-selected criteria; this is the default.
- **required:** every criterion requiring external authority must obtain policy-valid evidence or affect the gate.
- **automatic_for_external_claims:** classification proposes plans, but the user approves the visible plan before network requests.

## Primary demo requirement

The demo task is a TypeScript `sourced-answer-demo`: add an endpoint using current Responses API web search, restrict OpenAI product research to official OpenAI domains, preserve returned sources, parse actual citation annotations, and render visible clickable citations while treating repository and web content as untrusted.

The fourteen acceptance criteria are:

1. Use the current Responses API.
2. Enable `web_search`.
3. Restrict OpenAI product searches to official OpenAI documentation domains.
4. Request or retain returned source metadata.
5. Parse actual citation annotations.
6. Display citations visibly.
7. Display citations as clickable links.
8. Reject unsupported URL schemes.
9. Reject source identifiers not present in the source registry.
10. Treat retrieved content as untrusted.
11. Test cited responses.
12. Test responses with no sources.
13. Test malicious or invalid URLs.
14. Test fabricated source references.

The intentionally incomplete patch must fail for the correct reasons even if its happy-path test passes. The corrected patch must pass only when internal execution, external authority, and every required hybrid criterion succeed.

## Non-functional requirements

- **Local-first:** task data, repository evidence, source metadata, reports, and bundles remain local except for explicitly previewed API inputs.
- **Reproducible:** offline unit/E2E tests use sanitized fixtures; ordering and hashing are deterministic.
- **Bounded:** diff size, changed files, command output, searches, claims per run, and narrative length are limited by configuration.
- **Accessible:** cited links are visible, keyboard accessible, labeled, and retained in print/static export.
- **Explainable:** no opaque source-quality average and no model-controlled gate.
- **Secure by default:** HTTP(S)-only links, exact hostname policy, secret redaction, escaped output, no script execution from sources.
- **Reliable demo:** cached and live modes are visually distinct; cached data is never described as a live search.

## Success criteria

- A judge understands “source proves requirement, code does not implement it” within 15 seconds of opening the failing report.
- The same one-command demo consistently yields the expected failing and passing decisions.
- Every visible citation resolves to a validated returned source.
- A clean install and judge test path work as documented.
- Tests, type checking, lint, and build pass before submission.

## Explicit non-goals

No billing, team accounts, hosted private-repository storage, autonomous approval/merge, full-page archiving, generalized browsing/research, legal or security certification, every language, every research provider, complex multi-agent runtime, or generic chat UI during the MVP.

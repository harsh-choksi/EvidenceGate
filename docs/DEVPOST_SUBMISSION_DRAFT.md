# Devpost submission draft

This is an editable draft for human review. Devpost draft `1103829-evidencegate` was created on 2026-07-19; its overview and project-details story are saved. It is not a submission receipt, and the video, Codex feedback ID, eligibility, country, and final form fields must be completed and verified by the entrant.

## Project title

EvidenceGate

## Category

Developer Tools

## Tagline

Code evidence, source evidence, and a release decision you can inspect.

## Short description

EvidenceGate is a local-first TypeScript CLI that checks an AI-generated code change against explicit acceptance criteria. It keeps repository and execution evidence separate from authoritative external-source evidence, validates OpenAI web-search provenance and citations, and applies a deterministic release gate. A self-contained HTML report explains why each internal, external, or hybrid criterion passed, failed, or requires review.

## What it does

- Captures a bounded real Git comparison and runs configured checks with timeouts, output limits, and secret redaction.
- Classifies criteria into internal, external, and hybrid evidence domains.
- Previews exact source-search claims, queries, domains, model, and privacy boundaries before approved network access.
- Uses GPT-5.6 with OpenAI web search to collect a cited narrative, returned-source metadata, and native citation annotations.
- Uses a separate strict GPT-5.6 structured-output stage in the live demo to map only supplied criteria, evidence IDs, and source IDs.
- Rejects fabricated IDs, unsafe or credential-bearing URLs, disallowed domains, malformed ranges, stale-only support, and forged stored gate decisions; prompt-injection text remains untrusted data and cannot authorize evidence or IDs.
- Recomputes a deterministic gate and records a canonical SHA-256 hash over the complete evidence bundle.
- Produces a standalone, printable HTML report with visible, clickable inline citations and full source cards.

## Why it matters

AI-generated changes can look plausible while missing an acceptance criterion, relying on an obsolete API assumption, or citing a source that does not support the implementation. Tests alone cannot prove an external requirement is current, and official documentation cannot prove a repository implements it. EvidenceGate makes that boundary explicit and gives reviewers an inspectable Fail-to-Pass workflow instead of another model confidence score.

## Demo

Immediate no-build judge path:

**https://harsh-choksi.github.io/EvidenceGate/**

The hosted page exposes self-contained Fail and Pass HTML reports plus their canonical JSON bundles. It requires no account, API key, installation, or source rebuild and labels its sanitized OpenAI response fixture as cached rather than live.

Optional local cached demo:

Prerequisites: Git and Node.js 20.12 or newer.

```powershell
npx.cmd --yes pnpm@11.9.0 install --frozen-lockfile
npx.cmd --yes pnpm@11.9.0 demo
```

It evaluates two fixtures for the same sourced-answer task. The plausible incomplete patch fails because documentation can establish the current API requirement but cannot replace missing repository behavior and negative tests. The corrected patch passes after adding returned-source handling, native annotation parsing, URL/source-ID validation, visible clickable citations, untrusted-content controls, and adversarial tests.

Optional live mode is explicit:

```bash
Copy-Item .env.example .env # PowerShell
# Add OPENAI_API_KEY to .env
npx.cmd --yes pnpm@11.9.0 demo:live
```

A successful live GPT-5.6 Fail-to-Pass smoke test was completed on 2026-07-18 and is recorded in [implementation status](IMPLEMENTATION_STATUS.md). The cached path remains the reproducible, credential-free judge path.

## How Codex was used

Codex was the primary build collaborator for requirements decomposition, architecture, implementation, tests, adversarial review, documentation, and demo preparation. The entrant retained the product scope, evidence-domain boundary, authority policy, privacy decisions, and final release/submission control. Codex completion statements are never treated as release evidence by the product.

## How GPT-5.6 and OpenAI web search are used

Stage A performs approved, domain-bounded external research with `web_search` and retains native returned-source and citation provenance. Stage B receives bounded/redacted evidence and citation excerpts and returns strict structured assessments. Local schema, provenance, ID, freshness, and policy validation remains authoritative, and GPT-5.6 cannot directly set the release gate.

## Technology

TypeScript, Node.js, pnpm workspaces, OpenAI Responses API, GPT-5.6, OpenAI web search, Zod, Vitest, ESLint, Prettier, Git, and self-contained HTML/CSS reports.

## Links and human-only fields

- Repository URL: **https://github.com/harsh-choksi/EvidenceGate** (public and unauthenticated access verified)
- Hosted no-build judge demo: **https://harsh-choksi.github.io/EvidenceGate/**
- Supported platforms: **Windows, macOS, and Linux, contingent on the final three-platform CI run**
- Public YouTube demo: **PENDING RECORDING/UPLOAD/SIGNED-OUT CHECK**
- Primary Codex `/feedback` Session ID: **PENDING CAPTURE**
- Eligibility/team confirmation: **PENDING ENTRANT REVIEW**
- Final Official Rules/form review: **PENDING IMMEDIATELY BEFORE SUBMISSION**

The entrant must review every statement against the released commit and final video before manually submitting.

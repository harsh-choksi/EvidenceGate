# EvidenceGate demo script

Target: **2 minutes 50 seconds**. The official submission video must be less than three minutes. This is a recording plan; it does not claim that a video has been recorded or uploaded.

## Preflight

- Use a clean, large terminal and a browser already positioned for the report.
- Rehearse the exact commands from a fresh clone; update this script if the packaged invocation differs.
- From Windows PowerShell, install with `npx.cmd --yes pnpm@11.9.0 install --frozen-lockfile`. On macOS or Linux, use `npx` in place of `npx.cmd`.
- Inject `OPENAI_API_KEY` through the shell immediately before the live segment and remove it immediately afterward; never show the value.
- Pre-run the stable cached demo and retain its reports as an emergency backup.
- Prefer the verified live path for the recorded source-search segment. If cached results must be used, label them visibly and narrate them as cached—never imply a live call.
- Hide API keys, account details, notifications, private tabs, tokens, and local usernames.
- When exporting a report to PDF, disable browser **Headers and footers** so the local `file:///` path and username are not printed; reject any preview with orphaned section headings or a footer-only final page.
- Ensure source links open safely and that no third-party copyrighted music/material appears.
- Record a separate clean take rather than editing around failed commands.

## 0:00–0:15 — Problem

**Show:** the sourced-answer task, fourteen criteria, incomplete patch, and its one superficial passing test.

**Say:**

> AI-generated code can pass a test and still rely on outdated or invented requirements. EvidenceGate checks what the repository proves and what current authoritative sources require—without confusing those two things.

## 0:15–0:45 — Internal evidence

**Run/show:**

```powershell
npx.cmd --yes pnpm@11.9.0 demo
```

Open `.evidencegate/demo/incomplete/report.html`. Show the bounded repository findings: a normal response call, hard-coded source URLs, non-clickable citation text, no annotation parsing, unsafe URL acceptance, and missing negative tests.

**Say:**

> The patch looks plausible and its happy-path test passes. Internal evidence still finds no web-search tool configuration, no returned-source parsing, and no tests for fabricated citations or unsafe links.

## 0:45–1:10 — External source evidence

**Run/show:**

```powershell
npx.cmd --yes pnpm@11.9.0 demo:live
```

Running `demo:live` is the explicit approval for this packaged, domain-bounded live workflow. Open `.evidencegate/demo/live/incomplete/report.html`; show the exact normalized claim, official OpenAI domain restrictions, privacy summary, live label, native returned source records, and visible clickable citations to the current official web-search documentation. Do not substitute a direct `sources check` command here: that lower-level command requires a prepared task/configuration and `--approve`.

**Say:**

> With the approved plan, GPT-5.6 uses the Responses API web-search tool. EvidenceGate retains the actual source list and citation annotations, and accepts only citations that bind to those returned sources. OpenAI's current documentation requires web-result citations shown to users to be visible and clickable.

## 1:10–1:35 — Combined failure

**Show:** the criterion matrix and source card:

```text
External requirement: Supported
Internal implementation: Unsupported
Combined result: Fail
```

Point to missing implementation evidence, not just a red score.

Optionally verify the shown bundle in the terminal:

```powershell
npx.cmd --yes pnpm@11.9.0 evidencegate verify .evidencegate/demo/live/incomplete/evidence-bundle.json
```

**Say:**

> The official source proves what should be implemented. It does not prove this patch implemented it. Required hybrid claims need both layers, so the deterministic gate fails.

## 1:35–1:55 — Codex correction

**Show:** the primary Codex session applying the bounded correction and its concise diff: enable `web_search`, restrict official domains, request/retain sources, parse native annotations, validate IDs and HTTP(S) URLs, render accessible links, and add negative tests.

**Say:**

> I used Codex throughout the build for architecture, implementation, tests, security cases, and documentation. Here Codex fixes the missing behavior, while EvidenceGate—not Codex's completion claim—decides whether the change passes.

## 1:55–2:25 — Passing rerun

**Show:** the corrected result already produced by the same packaged live run.

```powershell
npx.cmd --yes pnpm@11.9.0 evidencegate verify .evidencegate/demo/live/corrected/evidence-bundle.json
npx.cmd --yes pnpm@11.9.0 evidencegate gate .evidencegate/demo/live/corrected/evidence-bundle.json
```

Open `.evidencegate/demo/live/corrected/report.html`. Show internal `Verified`, external `Supported`, hybrid `Verified`, tests passed, overall `Pass`, bundle hash, and one opened citation.

**Say:**

> Now repository checks verify the implementation, official sources support the current requirement, and every citation maps to returned metadata. GPT-5.6 performs research and structured evidence mapping, but versioned policy code computes the release decision.

## 2:25–2:50 — Impact

**Show:** failing and passing reports side-by-side plus the exported JSON bundle/hash.

**Say:**

> EvidenceGate gives developers an inspectable record of what code proves, what current sources say, and where they disagree before agent-generated changes ship. The static report and verifiable bundle make that decision reviewable without trusting a chatbot summary.

End on the product name/tagline and repository URL. Do not add a long feature list.

## Recording acceptance checklist

- [ ] Final duration is below 3:00; target remains 2:50.
- [ ] Audio clearly explains what was built and how Codex and GPT-5.6 were used.
- [ ] OpenAI web search and source/citation integrity are shown, with accurate live/cached labeling.
- [ ] Incomplete patch fails and corrected patch passes in the shown run.
- [ ] At least one real visible clickable official citation is demonstrated.
- [ ] No key, token, private data, unsafe link, or unauthorized media/mark is visible.
- [ ] Any shown/exported PDF was printed with browser headers and footers disabled and has no orphaned or near-blank final page.
- [ ] Public YouTube playback and audio work while signed out.
- [ ] User has reviewed the final cut before linking it in Devpost.

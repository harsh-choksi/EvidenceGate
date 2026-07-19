# Privacy

EvidenceGate is local-first. Offline analysis, cached demos, gate evaluation, bundle verification, and static report generation do not require an EvidenceGate-hosted service.

## Data processed locally

Depending on configuration, the CLI may read and store:

- task text and acceptance criteria;
- repository path, refs, changed-file names, bounded diffs, and source excerpts;
- configured command names, exit metadata, and bounded/redacted output;
- source-search previews, approved queries, source metadata, citations, and research narratives;
- gate assessments, findings, timestamps, model metadata, and bundle hashes.

Generated bundles and reports are local files. Treat them as potentially sensitive even when API keys have been redacted.

## Data sent in live mode

No network research occurs in source mode `off` or during the cached demo. In an approved live source check, EvidenceGate sends OpenAI:

- the normalized external claim or bounded query;
- source-domain filters and tool configuration;
- the selected model and response instructions.

In the separate live adjudication stage, EvidenceGate sends bounded and pattern-redacted acceptance criteria, internal evidence summaries, validated source metadata, the bounded research narrative, and native citation excerpts. It does not send full repository files or full fetched web pages. The adjudicator has no tools and may reference only supplied IDs. Raw task and evidence data remain local, although pattern redaction cannot guarantee removal of every sensitive value.

Source-only search queries exclude repository code by default. The planner redacts common secrets, credentials, emails, connection strings, and fenced code, then shows privacy warnings. Redaction is not comprehensive; the human preview is the final check before approval.

For OpenAI's service-side handling, retention, and account controls, consult the current [API data controls documentation](https://developers.openai.com/api/docs/guides/your-data) and the terms applicable to your account. EvidenceGate does not alter those policies.

## Credentials

`OPENAI_API_KEY` is read from the process environment for live calls. It must not be placed in task files, YAML configuration, prompts, fixtures, reports, or committed `.env` files. Command output and queries pass through pattern-based redaction, but users must still inspect artifacts before sharing them.

## Storage and retention

The default configuration stores source metadata and bounded research narratives, not full fetched web pages. Demo fixtures are sanitized and checked in for offline reproducibility. Generated output under the configured `.evidencegate` directory remains until the user deletes it according to their normal filesystem and backup policies.

EvidenceGate currently has no project-hosted account database or application telemetry service. Live calls still reach OpenAI, and configured repository commands may contact their own services; review those commands separately.

## Sharing and publication

Before uploading a report, bundle, demo video, CI artifact, or issue attachment:

1. inspect repository paths and excerpts;
2. inspect command output and environment-derived text;
3. inspect search queries and private identifiers;
4. confirm cached/live labels and retrieval timestamps;
5. confirm no credential appears in current content or Git history;
6. remove third-party or personal data you are not authorized to disclose.

Hash verification detects artifact changes; it does not make an artifact anonymous.

## Privacy limitations

- Pattern redaction can miss novel secret formats and contextual personal data.
- File names, diffs, logs, and source excerpts can reveal confidential architecture.
- A user-approved query can still reveal sensitive intent even without source code.
- Configured commands inherit the local process environment unless separately constrained.
- Operating-system, shell, package-manager, OpenAI, and repository-host logs are outside EvidenceGate's direct control.

Use a disposable environment and a narrowly scoped API key when evaluating untrusted or highly sensitive repositories.

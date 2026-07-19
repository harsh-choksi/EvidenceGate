# Security

EvidenceGate evaluates untrusted repositories and untrusted external information, but it is not a sandbox, antivirus product, security scanner, or certification system. Run it with the least privilege appropriate for the repository.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through the repository host's security-advisory channel or another private maintainer channel. Include the affected version/commit, reproduction steps, impact, and any suggested mitigation. Do not include real secrets, proprietary source, or exploit data from systems you do not own.

Do not open a public issue for an unpatched vulnerability. No response-time or bounty commitment is implied until the project publishes one.

## Security invariants

- Internal and external evidence stay separate.
- Model output cannot change policy or approve release.
- Citations must bind to returned source-registry records.
- Source links must be HTTP(S) and pass local domain rules.
- Repository text, command output, model output, and web content are data, never instructions.
- Live research follows the configured source mode and approval boundary.
- Secrets and proprietary code are excluded from source-only queries by default.
- Cached fixtures remain visibly labeled as cached.

## Safe operation

1. Review `.evidencegate.yml` and task files before running commands.
2. Treat configured commands as code execution. They run with the current user's permissions.
3. Use a disposable checkout/container for repositories you do not trust.
4. Set `OPENAI_API_KEY` through the environment or an ignored local `.env`; never commit it.
5. Inspect the source-plan preview before approving live research.
6. Review generated bundles/reports before sharing; they may contain paths, excerpts, command output, queries, and findings.
7. Open report links only when the displayed domain and policy are appropriate for your context.

## Implemented controls

| Area                   | Controls                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Schemas and references | Strict validation, unique IDs, known-ID checks, canonical hash verification, deterministic gate recomputation                         |
| Git and files          | Repository detection, bounded diff/file sizes, include/exclude boundaries                                                             |
| Commands               | Explicit configured commands, timeouts, bounded stdout/stderr, common-secret redaction                                                |
| Search planning        | Minimal external claim, code-block/token/email redaction, privacy warnings, explicit approval                                         |
| Source-result artifact | Exact task/config/canonical-plan binding, full-payload hash, typed parsing, and fresh policy/citation/semantic revalidation           |
| Model adjudication     | Bounded/redacted payload, evidence-not-instructions prompt, strict JSON schema, complete coverage and cross-bound ID checks           |
| Sources                | HTTP(S)-only URLs, no embedded credentials, canonical hostnames, block-first exact/subdomain matching, redirect-like parameter checks |
| Citations              | Native annotation parsing, range checks, same-provenance returned-source binding, fabricated-ID rejection                             |
| Reports                | HTML/attribute escaping, safe HTTP(S) links, `noopener noreferrer`, no embedded remote scripts/source HTML                            |
| Gate                   | Stored versioned policy inputs, hybrid AND rule, cross-layer assessment checks, and full stored-decision recomputation                |

Redaction is defense in depth, not a guarantee. Pattern-based analyzers can miss secrets, and malicious configured commands can read data available to the current process.

## Known security limitations

- The command runner uses the system shell for configured command strings; configuration is a trusted operator boundary.
- Timeouts and process termination are best-effort and are not an operating-system sandbox.
- URL checks do not replace network-layer controls, DNS protections, TLS validation, or final-redirect validation by a hardened fetcher.
- Static repository analyzers establish bounded evidence and can produce false positives or negatives.
- Authority classification cannot guarantee that a compromised official page is correct.
- A valid citation proves provenance, not truth.
- Generated artifacts can disclose repository information if shared.

See [THREAT_MODEL.md](THREAT_MODEL.md) for abuse cases and residual risk, and [PRIVACY.md](PRIVACY.md) for data handling.

## Release security checklist

- [ ] Offline verification suite passes.
- [ ] Dependency and license review completed.
- [ ] Secret scan reviewed, not merely run.
- [ ] Prompt-injection and citation-integrity negative tests pass.
- [ ] Live key does not appear in logs, errors, reports, bundles, video, or Git history.
- [ ] Generated static report was tested with adversarial source text and URLs.
- [ ] Current OpenAI request/response shape was checked against official documentation.
- [ ] A human reviewed the final demo and submission artifacts.

Unchecked items are open work, not implied completion.

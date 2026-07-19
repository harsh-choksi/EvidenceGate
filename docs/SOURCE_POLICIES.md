# Source policies

Source authority is enforced through validated configuration and code. Prompt text can explain a policy but cannot create, relax, or override it.

## Source modes

| Mode                            | Network behavior                                                   | Gate behavior                                                                                       |
| ------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `off`                           | Never search                                                       | External claims remain unresolved unless the task explicitly permits validated cached evidence      |
| `requested`                     | Search only user-selected criteria; default mode                   | Missing unrequested external evidence is shown according to criterion requirements; no hidden calls |
| `required`                      | Search all criteria marked as requiring external authority         | Retrieval/policy/integrity failure affects the gate                                                 |
| `automatic_for_external_claims` | Classifier proposes plans; user approves visible plan before calls | Only approved plans execute; code is excluded from source-only queries by default                   |

Cached fixtures and cached prior research are separate from live mode and must be labeled with their original retrieval time and validation status.

## Policy catalog

| Policy                 | Required/preferred authority                                                                                  | Typical use                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `official_only`        | Authorized official publisher domains                                                                         | Product behavior, API documentation, competition rules                       |
| `primary_sources`      | Original specifications, official docs, government publications, release notes, registries, original research | General fact checking where direct authority exists                          |
| `standards_bodies`     | Original standards or recognized security/standards organizations                                             | Protocol, accessibility, security, and standards requirements                |
| `vendor_documentation` | Official vendor docs and versioned release/deprecation material                                               | Current SDK/API syntax and support                                           |
| `maintainer_sources`   | Official project docs, repository, release notes, registry entry                                              | Open-source behavior and versions                                            |
| `peer_reviewed`        | Original peer-reviewed research, with date/method limits                                                      | Scientific claims                                                            |
| `government_sources`   | Official government/regulator publications                                                                    | Regulation and public guidance; human review still required for legal claims |
| `reputable_broad`      | Transparent reputable secondary sources                                                                       | Interpretation or fallback only when primary authority is unavailable        |
| `custom`               | User-defined source types, domains, count, freshness, jurisdiction, language                                  | Project-specific authority rules                                             |

A standards summary page does not establish complete compliance. A community post cannot satisfy an official-only policy merely because its content appears correct.

## Policy selection rules

- Current vendor API/model/SDK claim: `vendor_documentation` or `official_only`.
- Package-version claim: `maintainer_sources`, preferring the official registry or release.
- Normative standard: `standards_bodies`, preserving exact version/edition.
- Security recommendation: original standard, OWASP/NIST or another configured recognized body.
- Legal/regulatory current-state claim: `government_sources`, explicit jurisdiction/date, and manual professional review.
- Scholarly finding: `peer_reviewed`, retaining paper/date/method limitations.
- Hackathon rule: `official_only` on official sponsor/administrator domains.

If primary authority is unavailable, the report states that limitation and does not silently downgrade the requirement.

## Domain enforcement

Provider-side filtering narrows search, but local validation is authoritative for acceptance:

1. Parse with a maintained URL parser; reject credentials, parse failures, and unsupported schemes.
2. Convert the hostname to its canonical ASCII/lowercase representation and remove a terminal dot.
3. Evaluate blocked rules first.
4. Match allowed rules by explicit type:
   - `exact`: hostname must equal the configured hostname;
   - `include_subdomains`: hostname is equal to the base or ends with `.` plus the base.
5. Never use substring or suffix-only matching without the dot boundary.
6. Validate the final redirect destination under the same rules when redirects are followed.

Thus `developers.openai.com.evil.example`, `openai-docs.example`, and `openai.com.fake-domain.example` do not match `openai.com`.

For OpenAI product claims, the default official-documentation policy explicitly covers `developers.openai.com` and `platform.openai.com`, with subdomain behavior recorded rather than assumed. Add another official host only when a specific claim requires it, and recheck ownership before live use.

## Freshness defaults

These are configurable starting points, not universal truth:

| Claim                         |                Suggested maximum age |
| ----------------------------- | -----------------------------------: |
| Current API syntax            |                              30 days |
| Current model or SDK support  |                              30 days |
| Current package version       |                               7 days |
| Maintainer guidance           |                              90 days |
| Security standard/version     | 365 days or explicit current version |
| Current government regulation |     30 days plus jurisdiction review |
| Stable technical concept      |                             730 days |

Published/updated dates, version scope, deprecation notices, and current documentation location matter. Retrieval time alone does not prove freshness.

`maxSourceAgeDays: null` is an explicit non-restrictive policy, not evidence that a document was recently published. The packaged live demo uses this override for canonical OpenAI documentation because returned search metadata may omit publication/update dates; it records the policy and retrieval provenance rather than fabricating a date. Cached demo mode continues to use a 30-day maximum.

## Example policy configuration

```yaml
sources:
  mode: requested
  provider: openai_web_search
  previewRequired: true
  storeFullPageContent: false
  policies:
    openai_official:
      sourcePolicy: official_only
      allowedDomains:
        - host: developers.openai.com
          match: include_subdomains
        - host: platform.openai.com
          match: include_subdomains
      minimumSourceCount: 1
      maxSourceAgeDays: 30
```

The implementation's actual schema may use a normalized equivalent, but it must preserve explicit match semantics.

## Minimum source count and conflict behavior

Minimum count is evaluated after scheme/domain/deduplication checks. Multiple URLs that reproduce the same underlying authority need not count as independent corroboration. One direct official source may satisfy an official API claim when policy allows it; competing authoritative versions trigger conflict analysis, not averaging.

## Overrides

An override requires user identity/name, time, affected criterion/source, previous result, new result, bounded reason, and policy version. Overrides cannot fabricate a source, repair an invalid citation, or cause the report to describe cached results as live. High-stakes and unresolved-conflict overrides remain visibly flagged.

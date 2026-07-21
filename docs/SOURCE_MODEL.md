# External source model

## Purpose

The source model preserves what the research provider actually returned, then adds transparent policy evaluation. Generated prose is not a source registry, and a URL mentioned only by the model is not acceptable evidence.

## Verified OpenAI integration baseline

Verified against the official documentation on **2026-07-18**:

- GPT-5.6 is available through the Responses API; the `gpt-5.6` alias identifies GPT-5.6 Sol on the current [model catalog](https://developers.openai.com/api/docs/models).
- The Responses API enables research with `tools: [{ type: "web_search" }]`.
- `filters.allowed_domains` and `filters.blocked_domains` provide provider-side domain filtering; domain values omit the URL scheme. The provider filter includes subdomains, so EvidenceGate also performs its own stricter post-validation.
- `include: ["web_search_call.action.sources"]` requests the full list of URLs consulted. The full `sources` list is distinct from inline citations, which identify the most relevant references.
- Responses include a `web_search_call` output item and message output containing `url_citation` annotations. An annotation contains the cited URL/title and location range.
- When web-derived results are shown to users, inline citations must be clearly visible and clickable.

This baseline describes the recorded 2026-07-18 Sol-alias run and remains historical evidence. The active API default is now `gpt-5.6-terra`, which the current model catalog documents as supporting the Responses API, structured outputs, and web search. Terra's separate live source-research test and bounded two-pass packaged Fail-to-Pass workflow both passed on 2026-07-20. A detector-only recognition fix followed that run, so an exact-head live smoke remains pending before the final release capture.

See the official [Web search guide](https://developers.openai.com/api/docs/guides/tools-web-search). These facts are time-sensitive and must be rechecked before release.

## Source-search plan

Research begins with a plan, not an API call:

```ts
interface SourceSearchPlan {
  criterionId: string;
  normalizedExternalClaim: string;
  queries: SearchQuery[];
  sourcePolicy: SourcePolicy;
  allowedDomains: string[];
  blockedDomains: string[];
  maxSourceAgeDays: number | null;
  minimumSourceCount: number;
  rationale: string;
  requiresUserApproval: boolean;
}
```

The preview shows exact normalized claims, exact queries, domain rules, freshness, expected authority, model, expected call count, and whether repository content is included. Queries contain product/standard/version/date context, not proprietary code, secrets, customer data, full stack traces, or unrelated private ticket text.

## Research-run provenance

Each attempt records a stable research-run ID, affected criterion IDs, exact model identifier/alias, web-search call IDs, queries, approved domain rules, start/completion times, source/citation counts, and `completed`, `partial`, `failed`, or `cancelled` status. Retries create new runs; they do not overwrite failed provenance.

## Source registry

The machine-readable source registry is authoritative for which sources exist. Each `ExternalSourceRecord` contains:

### Provider-observed provenance

- research-run and web-search-call IDs;
- returned URL and title;
- retrieval time and citation annotations;
- provider source metadata available in the response.

### Deterministically derived fields

- stable internal `sourceId`;
- normalized URL and canonical hostname;
- deduplication relationship;
- parsed publisher/date/version information when supported by observed metadata;
- content hash when bounded source content is lawfully retained.

### Policy/adjudication fields

- source type, primary/official flags, domain-policy result, and freshness status;
- supported and contradicted claim IDs;
- conflicts, limitations, and any parsing uncertainty.

EvidenceGate assigns its own stable source IDs after validation. It must not imply that generated source IDs came from OpenAI when the provider returned only URL-based metadata.

## Citation record

```ts
interface CitationAnnotation {
  citationId: string;
  sourceId: string;
  startIndex?: number;
  endIndex?: number;
  citedText?: string;
}
```

Native annotations are preserved, normalized, range-checked using the provider adapter's documented index semantics, and bound to an internal source record through the returned URL/provenance. Multiple citations may bind to one deduplicated source. Full rules are in [CITATION_INTEGRITY.md](CITATION_INTEGRITY.md).

## Transparent authority model

Every source records:

- `sourceType`: official documentation, standard, government, maintainer release, package registry, peer reviewed, official repository, reputable secondary, community, or unknown;
- whether it is primary and official;
- whether currentness can be established (`true`, `false`, or unknown);
- publisher match and domain-policy result;
- whether it conflicts with other sources;
- specific limitations.

No mysterious aggregate “quality score” is used. Policy rules decide whether these attributes satisfy a claim. For example, a current vendor API claim requires official vendor authority; a package version prefers its registry/release; legal claims require official legal/government material and qualified human review.

## Freshness

Retrieval today does not make an old page current. Freshness evaluation considers observed publish/update dates, version identifiers, current documentation paths, deprecation notices, retrieval time, and the claim's configured maximum age. Status is `current`, `possibly_stale`, `stale`, or `unknown`.

If only stale evidence exists for a current claim, the assessment is not silently `supported`; it becomes partial/insufficient or follows an explicit auditable override.

## Conflicts and deduplication

- Normalize URLs before deduplication while retaining every observed original URL and citation.
- Do not merge records whose normalized identity or publisher/version scope is uncertain.
- Preserve conflicting official and secondary sources, record the precise disagreement, and consider authority, date, version, and jurisdiction.
- Credible unresolved conflict produces `conflicting_sources` and normally `Manual Review`.
- Redirect targets are validated against policy; a permitted initial hostname cannot bypass policy by redirecting to a blocked destination.

## Source lifecycle

1. Receive provider output and retain bounded raw provenance for debugging.
2. Parse web-search calls, requested complete sources, and native annotations.
3. Validate URL scheme and syntax; normalize URL/hostname.
4. Enforce allowed/blocked domain policy and redirect policy.
5. Assign stable internal IDs and deduplicate safely.
6. Bind and validate every citation.
7. Classify source type/authority and evaluate freshness.
8. Detect conflicts and assess claims using only registry IDs.
9. Serialize the registry, research run, and limitations into the evidence bundle.

Complete copyrighted pages are not stored by default. EvidenceGate stores source metadata, URLs, annotations, bounded narrative, and hashes where available and lawful.

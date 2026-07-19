# OpenAI integration

This document defines EvidenceGate's OpenAI boundary. It describes the implemented contract and required verification. A successful live API Fail-to-Pass smoke test using the `gpt-5.6` Sol alias was completed on 2026-07-18; the active default is now Terra and still requires a post-migration live run after API quota is restored. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the recorded command and bundle evidence.

## Runtime role

Current live mode defaults to `gpt-5.6-terra` through the OpenAI Responses API for two separately bounded jobs:

1. **External research:** use an approved `web_search` plan to produce a cited narrative and native returned-source provenance.
2. **Evidence adjudication:** map supplied criteria to bounded internal evidence and validated external source IDs using strict structured output.

The cached demo performs deterministic assessments and makes no network request. Live demo mode executes both stages. GPT-5.6 does not compute or override the release gate: Stage B output must cross strict schema, coverage, ID-binding, freshness, and deterministic-status validation, after which pure policy code recomputes the release decision.

## Request contract

The source-research adapter builds a Responses API request equivalent to:

```ts
const filters = {
  ...(approvedDomains.length > 0 ? { allowed_domains: approvedDomains } : {}),
  ...(blockedDomains.length > 0 ? { blocked_domains: blockedDomains } : {}),
};

await client.responses.create({
  model: "gpt-5.6-terra",
  input: approvedMinimalClaimQuery,
  tools: [
    {
      type: "web_search",
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
    },
  ],
  include: ["web_search_call.action.sources"],
});
```

Empty domain lists are omitted rather than serialized as empty arrays because each domain-filter
property must contain at least one domain when it is present.

The exact SDK types are isolated at the provider boundary. Normalized core records do not expose provider-specific response objects.

The adjudication adapter builds a second Responses request with `text.format.type: "json_schema"`, `strict: true`, and a closed schema for internal, external, and combined assessments. Its prompt treats every nested string as untrusted data and disables tools and outside knowledge. Criteria, evidence summaries, research narrative, and bounded source-bound narrative contexts derived from validated native annotations are normalized and secret-redacted before transmission. Those contexts remain model-written narrative hints, not source quotations or provenance. Hybrid criteria carry explicit `internalClaim` and `externalClaim` facets: internal evidence is assessed only against the implementation facet, external evidence only against the source facet, while `normalizedClaim` remains the output identity. A projected facet must stay within its criterion and evidence domain; it cannot absorb an obligation owned by another required criterion. Each source has an explicit candidate criterion scope; provisional `claimsSupported` labels are evidence hints, not authorization. Per-criterion constraints list the eligible evidence IDs, source IDs, policy-allowed current IDs, and policy-allowed non-current IDs. The response must cover every supplied criterion exactly once and can reference only eligible supplied IDs. Local validation requires current allowed support before accepting `supported`, caps otherwise adequate but unknown or possibly stale evidence at partial support, and treats stale or absent evidence as insufficient. Combined statuses must match the same core deterministic reducer used by the release gate.

OpenAI's official documentation recommends the Responses API for new projects and documents built-in web search. The web-search guide and API reference document domain filters, `search` actions with `action.sources`, `open_page` and `find_in_page` actions with direct `action.url` provenance, native `url_citation` annotations, and visible clickable citations:

- [Migrate to the Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Web search](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Structured model outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [GPT-5.6 Terra model](https://developers.openai.com/api/docs/models/gpt-5.6-terra)

## Approval and privacy boundary

Before live network access, EvidenceGate derives a plan containing the normalized external claim, exact queries, allowed and blocked domains, freshness, minimum source count, rationale, and privacy warnings. Plans that require approval cannot execute until approved.

Source-only queries exclude repository code by default. Redaction removes common API tokens, authorization headers, credentials, private keys, emails, connection strings, and fenced code. These controls reduce accidental disclosure; they are not a complete secret detector. The operator must inspect the preview.

## Response and citation validation

The adapter treats the entire response as untrusted data:

1. Validate the response shape and locate `web_search_call` items.
2. Require completed calls and exact documented action shapes. Retain `search.action.sources[]` URLs and the direct `action.url` from `open_page` and `find_in_page`; unknown actions, duplicate IDs, malformed actions, and non-URL search-source records fail closed.
3. Parse message `output_text` and native `url_citation` annotations.
4. Validate annotation ranges against the exact response text.
5. Normalize URLs, reject non-HTTP(S) schemes and embedded credentials, and enforce local domain policy.
6. Bind citations to returned source records from the same provenance using exact normalized URLs. A versioned exact equivalence may be used only for an audited URL pair, after both URLs pass policy, when one same-response returned record exists; never synthesize a replacement source.
7. Apply freshness, authority, minimum-count, and conflict rules.
8. Permit later adjudication to reference only known internal source IDs.

Provider-side domain filtering is defense in depth. Local hostname comparison and source-registry validation decide whether evidence is admissible.

## Configuration

Copy `.env.example` to `.env` or set variables in the process environment:

```text
OPENAI_API_KEY=                 # required for live calls only
EVIDENCEGATE_OPENAI_MODEL=gpt-5.6-terra
RUN_LIVE_OPENAI_TESTS=false    # must be true as well for live tests
```

The API key must never be placed in task JSON, YAML configuration, search queries, fixtures, reports, or committed files. Prefer process environment injection or a local ignored `.env` file.

Use a dedicated OpenAI Project and a **Restricted** project key for live verification. The minimum project-key permissions are `Model capabilities: Request` and `Responses API: Write`; `gpt-5.6-terra` must be enabled in the project's Model Usage settings. `List models` and unused resources such as Assistants, Threads, Files, Vector Stores, Prompts, Batch, Evals, Fine-tuning, and Videos remain `None`. Web search is invoked within the Responses request and has no separate published key permission. Keep the key out of GitHub Actions, inject it only for the bounded live command, and revoke a temporary release key afterward.

The default repository configuration is illustrated by `.evidencegate.example.yml`. For OpenAI product claims, the implementation's official-documentation preset allowlists `developers.openai.com` and `platform.openai.com`; callers can provide an explicit policy when another official host is required.

## Cached and live modes

`pnpm demo` uses sanitized cached response fixtures and makes no live-research claim. `pnpm demo:live` requires an API key, performs an explicitly labeled live run, and records retrieval timestamps and research metadata. Cached material must always retain a cached label and its fixture provenance. Cached artifacts remain under `.evidencegate/demo/<scenario>/`; live artifacts are isolated under `.evidencegate/demo/live/<scenario>/` so a diagnostic live run cannot replace the reproducible cached bundles.

Live tests require both `OPENAI_API_KEY` and `RUN_LIVE_OPENAI_TESTS=true`. Ordinary CI must stay offline.

Direct use of the adjudicator environment factory additionally requires `RUN_LIVE_OPENAI_ADJUDICATION=true`. The explicit `pnpm demo:live` command supplies that adjudication opt-in internally because invoking the command is already an affirmative live action. The shared research request has a 90-second bound. Each scenario's initial adjudication and possible correction share a separate 90-second bound. A normal run makes three API calls; both adjudications needing correction raises the maximum to five.

The packaged live demo applies an explicit no-maximum-age policy to canonical OpenAI documentation because returned web-search source metadata can omit publication/update dates. This does not infer or fabricate a source date; it makes age non-restrictive and records the policy version, retrieval time, and provenance. Cached demo mode retains a 30-day maximum age.

## Failure behavior

Malformed response shapes, fabricated source references, invalid ranges, unsafe URLs, disallowed domains, insufficient sources, and provider failures cannot be normalized away. They produce explicit integrity issues and, when required evidence is affected, a source or analysis error under gate policy.

The live demo permits exactly one correction request when Stage B returns invalid JSON, violates the strict output schema, or fails local ID/binding/status validation. The correction receives the same bounded/redacted input plus at most 50 sanitized validation issues; it receives no tools, raw prior response, or `previous_response_id`. Refusals, incomplete responses, invalid local input, provider failures, and aborted operations are not retried. The same strict validator checks the correction, repeated failure propagates, and retry remains disabled by default for direct library users.

## Verification checklist

- [x] Confirm the configured account could call the `gpt-5.6` Sol alias on 2026-07-18.
- [ ] Confirm the configured account can call `gpt-5.6-terra` after API quota is restored.
- [x] Confirm one live Responses API `web_search` tool call.
- [ ] Confirm search-source arrays and direct open/find action URLs are retained from completed `web_search_call` items.
- [x] Confirm native citation annotations bind to returned sources.
- [x] Confirm allowed-domain behavior with current official OpenAI hosts.
- [ ] Confirm the generated report renders citations visibly and clickably.
- [ ] Confirm logs, errors, reports, and bundles do not contain the API key.
- [x] Record the commands and timestamps in `IMPLEMENTATION_STATUS.md`.

Do not check these boxes based on fixtures or documentation alone.

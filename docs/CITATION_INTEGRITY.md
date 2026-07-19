# Citation integrity

## Security property

A displayed citation is valid only when it is derived from a native citation annotation, binds to a source actually returned in the same research provenance, passes URL/domain policy, and points to the text range it claims to cite. Model-written prose, a plausible URL, or an invented source ID is never sufficient.

The official OpenAI [Web search guide](https://developers.openai.com/api/docs/guides/tools-web-search) states that Responses API web-search output contains `url_citation` annotations and that web-derived citations shown to end users must be clearly visible and clickable. EvidenceGate additionally requests `web_search_call.action.sources` and retains the documented direct URLs from completed `open_page` and `find_in_page` actions so citations can be compared with same-response provider provenance.

## Validation pipeline

1. Parse and schema-check the complete Responses API output.
2. Locate each completed `web_search_call`; accept only the documented action shapes: `search.action.sources[]`, `open_page.action.url`, or `find_in_page.action.url` plus its pattern. Reject duplicate call IDs, malformed known actions, non-URL search-source records, and unknown action types.
3. Parse message output and every native `url_citation` annotation.
4. Validate annotation URL, title, and optional start/end positions without trusting generated prose.
5. Normalize URLs and build the source registry only from those structured same-response action records, never from narrative prose or annotation URLs alone.
6. Bind each annotation to a returned record using exact normalized URL plus research-call provenance. A reviewed, versioned exact URL-equivalence pair may be used only after both URLs independently pass policy and only when it resolves to one same-response returned record.
7. Reject or flag annotations that are unmapped, ambiguous, out of range, reversed, or associated with disallowed sources.
8. Preserve multiple valid annotations to one deduplicated source and record conflicting metadata.
9. Allow Stage-B model output to reference only known internal source IDs; reject the entire affected structured result on invented IDs.
10. Render only validated citations from the bundle used by the gate.

## URL safety

Only `https:` and, when policy permits, `http:` are accepted; HTTPS is preferred. Reject at least `javascript:`, `data:`, `file:`, `ftp:`, `chrome:`, `about:`, and `blob:` schemes, protocol-relative ambiguity, malformed URLs, embedded credentials, and control-character tricks.

Normalize with a maintained parser:

- lowercase/canonicalize the hostname and internationalized domain;
- remove default ports;
- handle fragments consistently for identity while preserving the safe outbound destination when needed;
- remove tracking parameters only through an explicit safe list;
- do not collapse distinct query parameters that change document/version meaning.

Redirects cannot launder a source. If resolution follows redirects, the final destination must pass the same scheme and domain rules.

EvidenceGate does not follow citation redirects dynamically. It currently recognizes one audited exact equivalence: the legacy OpenAI Web Search guide URL at `https://platform.openai.com/docs/guides/tools-web-search` and its canonical returned-source URL at `https://developers.openai.com/api/docs/guides/tools-web-search`. Exact lookup runs first; alias lookup never creates or counts a source, and the rendered URL, source ID, authority, freshness, and metadata remain those of the same-response returned record. Alias use is recorded as a nonfatal issue and source limitation. Similar paths, semantic query differences, HTTP variants, non-default ports, userinfo, and look-alike hosts remain distinct and fail closed.

## Domain safety

Block rules take precedence. Allowed-domain matching uses exact canonical hostname equality or an explicit subdomain rule with a dot boundary. Never authorize with substring matching. In particular, these are not OpenAI domains:

```text
developers.openai.com.evil.example
openai-docs.example
openai.com.fake-domain.example
```

Provider-side filters reduce unwanted results but do not replace local post-validation.

## Range integrity

When start/end indices are present:

- use the provider adapter's documented character-index semantics;
- require finite integers with `0 <= start < end <= text length` under those semantics;
- preserve the exact returned response text used for validation;
- derive `citedText` from the validated range rather than accept model-supplied text;
- test Unicode, surrogate pairs, combining characters, boundary positions, overlap, and multiple annotations.

An invalid range invalidates that annotation. If a required claim then lacks valid citations, the external assessment cannot be `supported`.

For Stage B, EvidenceGate may also extract a bounded surrounding line or window from the already validated narrative range so the adjudicator can see the claim associated with a citation marker. This source-bound context remains untrusted model-written narrative: it is not a quotation from the retrieved page, cannot create a source record, and cannot authorize a source ID. The exact annotation range, returned source registry, and local policy checks remain authoritative.

## Rendering requirements

- Put inline citations next to the web-derived statement; do not hide all provenance in an appendix.
- Render a visible link labeled with source title and/or destination domain.
- Preserve clickable links in the self-contained static export and readable title plus URL in print.
- Make links keyboard accessible and visually focusable.
- Escape all source-derived text and attributes.
- Open external links with safe attributes such as `target="_blank"` and `rel="noopener noreferrer"` when a new tab is used.
- Never embed or execute returned page HTML or scripts.
- Show source type, publisher/domain, retrieval date, freshness, conflicts, and limitations in the source view.

Citations establish what a source says, not that the source is correct or that the code implements it.

## Failure behavior

| Failure                                           | Required behavior                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Citation URL absent from returned source registry | Reject unless one reviewed exact equivalence resolves uniquely to a same-response returned record       |
| Stage-B assessment references unknown source ID   | Reject structured assessment and retry/fail under bounded policy                                        |
| Unsupported URL scheme or malformed URL           | Reject source before rendering                                                                          |
| Source violates allowed/blocked domain policy     | Exclude as evidence, retain safe diagnostic metadata, and reassess count                                |
| Invalid/ambiguous annotation range                | Reject annotation; never guess the intended text                                                        |
| Duplicate normalized URL                          | Preserve annotations and original metadata; point them to one canonical source when identity is certain |
| Credible sources conflict                         | Preserve both and route to `conflicting_sources` / `Manual Review` as policy requires                   |
| Only stale source supports a current claim        | Mark stale and do not silently return full support                                                      |

No failure path may convert missing provenance into a generated replacement URL or ID.

## Required tests

- successful response with one and multiple sources;
- completed `open_page` and `find_in_page` action URLs, cross-action deduplication, and retained call IDs;
- non-completed, malformed, duplicate-ID, unknown-action, spoofed-action-field, and non-URL source failures;
- no search result and no-source message;
- source present but no inline citation;
- citation URL absent from complete returned source list;
- reviewed exact URL-equivalence success plus unlisted-path/query/scheme/look-alike failures;
- fabricated structured-output source ID;
- invalid, negative, reversed, oversized, and Unicode-sensitive ranges;
- duplicate URL variants and conflicting metadata;
- exact hostname and permitted-subdomain cases;
- look-alike/IDN domains, blocked hosts, and redirect-like bypasses;
- every allowed and denied URL scheme;
- stale and conflicting sources;
- repository and web prompt-injection fixtures;
- visible, keyboard-accessible links in static HTML and title/URL in print;
- bundle verification after a citation/source record is tampered with.

import { describe, expect, it } from "vitest";

import {
  CitationIntegrityError,
  assertSourceReferencesExist,
  createSourceSearchPlan,
  parseCachedOpenAIResearchResponse,
  parseOpenAIWebSearchResponse,
} from "../src/index.js";
import {
  DISALLOWED_OPEN_PAGE_RESPONSE,
  DUPLICATE_SOURCE_RESPONSE,
  FABRICATED_CITATION_RESPONSE,
  FIND_IN_PAGE_CITATION_RESPONSE,
  HTTP_ALIAS_CITATION_RESPONSE,
  INVALID_RANGE_RESPONSE,
  MISSING_OPEN_PAGE_URL_RESPONSE,
  NO_SEARCH_RESULT_RESPONSE,
  OPEN_PAGE_CITATION_RESPONSE,
  REVERSE_VERIFIED_ALIAS_CITATION_RESPONSE,
  SEARCH_AND_OPEN_PAGE_DUPLICATE_RESPONSE,
  SEMANTIC_QUERY_ALIAS_CITATION_RESPONSE,
  SUCCESSFUL_SOURCED_RESPONSE,
  UNLISTED_PLATFORM_CITATION_RESPONSE,
  UNKNOWN_ACTION_URL_RESPONSE,
  VERIFIED_ALIAS_CITATION_RESPONSE,
} from "./fixtures/openai-responses.js";

const plan = createSourceSearchPlan({
  criterionId: "criterion-citations",
  externalClaim: "The OpenAI Responses API supports web search.",
  productOrStandard: "OpenAI Responses API",
});
const retrievedAt = new Date("2026-07-18T00:00:00.000Z");
const liveDocumentationPlan = createSourceSearchPlan({
  criterionId: "criterion-live-action-provenance",
  externalClaim: "The OpenAI Responses API supports web search.",
  productOrStandard: "OpenAI Responses API",
  sourcePolicyOverrides: { maxSourceAgeDays: null },
});

describe("OpenAI source and citation binding", () => {
  it("binds annotations only to API-returned source metadata", () => {
    const result = parseCachedOpenAIResearchResponse(SUCCESSFUL_SOURCED_RESPONSE, plan, {
      retrievedAt,
      strict: true,
    });
    expect(result.registry.valid).toBe(true);
    expect(result.registry.sources).toHaveLength(1);
    expect(result.registry.citations).toHaveLength(1);
    expect(result.registry.citations[0]?.sourceId).toBe(result.registry.sources[0]?.sourceId);
    expect(result.registry.sources[0]?.normalizedUrl).toBe(
      "https://developers.openai.com/api/docs/guides/tools-web-search",
    );
    expect(result.registry.sources[0]?.freshnessStatus).toBe("current");
  });

  it.each([
    ["open_page", OPEN_PAGE_CITATION_RESPONSE],
    ["find_in_page", FIND_IN_PAGE_CITATION_RESPONSE],
  ] as const)("binds citations to a completed %s action URL", (provenanceKind, response) => {
    const parsed = parseOpenAIWebSearchResponse(response);
    expect(parsed.issues).toEqual([]);
    expect(parsed.returnedSources).toEqual([
      expect.objectContaining({
        provenanceKind,
        url: "https://developers.openai.com/api/docs/guides/tools-web-search",
      }),
    ]);

    const result = parseCachedOpenAIResearchResponse(response, liveDocumentationPlan, {
      retrievedAt,
      strict: true,
    });
    expect(result.registry.valid).toBe(true);
    expect(result.registry.sources).toHaveLength(1);
    expect(result.registry.citations[0]?.sourceId).toBe(result.registry.sources[0]?.sourceId);
  });

  it("deduplicates search and open-page provenance while retaining both call IDs", () => {
    const result = parseCachedOpenAIResearchResponse(
      SEARCH_AND_OPEN_PAGE_DUPLICATE_RESPONSE,
      liveDocumentationPlan,
      { retrievedAt, strict: true },
    );

    expect(result.registry.sources).toHaveLength(1);
    expect(result.registry.sources[0]?.webSearchCallIds).toEqual([
      "ws_fixture_1",
      "ws_fixture_open_page_duplicate",
    ]);
    expect(result.metadata.webSearchCallIds).toEqual([
      "ws_fixture_1",
      "ws_fixture_open_page_duplicate",
    ]);
  });

  it.each([
    ["a missing open-page URL", MISSING_OPEN_PAGE_URL_RESPONSE, "missing_source_url"],
    ["an unknown action URL", UNKNOWN_ACTION_URL_RESPONSE, "invalid_response_shape"],
  ] as const)("rejects %s as source provenance", (_label, response, issueCode) => {
    const result = parseCachedOpenAIResearchResponse(response, liveDocumentationPlan, {
      retrievedAt,
    });
    expect(result.registry.valid).toBe(false);
    expect(result.registry.sources).toHaveLength(0);
    expect(result.registry.citations).toHaveLength(0);
    expect(result.registry.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: issueCode, fatal: true }),
        expect.objectContaining({ code: "unsupported_citation_url", fatal: true }),
      ]),
    );
  });

  it("applies the same domain policy to direct action URLs", () => {
    const result = parseCachedOpenAIResearchResponse(
      DISALLOWED_OPEN_PAGE_RESPONSE,
      liveDocumentationPlan,
      { retrievedAt },
    );
    expect(result.registry.valid).toBe(false);
    expect(result.registry.sources).toHaveLength(0);
    expect(result.registry.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "disallowed_source_domain", fatal: true }),
      ]),
    );
  });

  it("does not admit sources from non-completed calls", () => {
    const response = {
      ...OPEN_PAGE_CITATION_RESPONSE,
      output: [
        {
          ...OPEN_PAGE_CITATION_RESPONSE.output[0],
          status: "in_progress",
        },
        OPEN_PAGE_CITATION_RESPONSE.output[1],
      ],
    } as const;
    const parsed = parseOpenAIWebSearchResponse(response);
    expect(parsed.returnedSources).toEqual([]);
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_response_shape", fatal: true }),
      ]),
    );
  });

  it("parses sources only from the documented search action shape", () => {
    const spoofedSource = {
      type: "url",
      url: "https://platform.openai.com/docs/guides/unlisted-page",
    } as const;
    const openWithSpoofedSources = {
      ...OPEN_PAGE_CITATION_RESPONSE,
      output: [
        {
          ...OPEN_PAGE_CITATION_RESPONSE.output[0],
          action: {
            ...OPEN_PAGE_CITATION_RESPONSE.output[0].action,
            sources: [spoofedSource],
          },
        },
        OPEN_PAGE_CITATION_RESPONSE.output[1],
      ],
    } as const;
    expect(parseOpenAIWebSearchResponse(openWithSpoofedSources).returnedSources).toEqual([
      expect.objectContaining({
        provenanceKind: "open_page",
        url: "https://developers.openai.com/api/docs/guides/tools-web-search",
      }),
    ]);

    const searchWithNonUrlSource = {
      ...SUCCESSFUL_SOURCED_RESPONSE,
      output: [
        {
          ...SUCCESSFUL_SOURCED_RESPONSE.output[0],
          action: {
            ...SUCCESSFUL_SOURCED_RESPONSE.output[0].action,
            sources: [
              {
                ...SUCCESSFUL_SOURCED_RESPONSE.output[0].action.sources[0],
                type: "file",
              },
            ],
          },
        },
        SUCCESSFUL_SOURCED_RESPONSE.output[1],
      ],
    } as const;
    const parsed = parseOpenAIWebSearchResponse(searchWithNonUrlSource);
    expect(parsed.returnedSources).toEqual([]);
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_response_shape", fatal: true }),
      ]),
    );
  });

  it("rejects duplicate web-search call IDs before merging provenance", () => {
    const response = {
      ...SEARCH_AND_OPEN_PAGE_DUPLICATE_RESPONSE,
      output: [
        SEARCH_AND_OPEN_PAGE_DUPLICATE_RESPONSE.output[0],
        {
          ...SEARCH_AND_OPEN_PAGE_DUPLICATE_RESPONSE.output[1],
          id: "ws_fixture_1",
        },
        SEARCH_AND_OPEN_PAGE_DUPLICATE_RESPONSE.output[2],
      ],
    } as const;
    const parsed = parseOpenAIWebSearchResponse(response);
    expect(parsed.returnedSources).toHaveLength(1);
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_response_shape", fatal: true }),
      ]),
    );
  });

  it("rejects a generated citation URL absent from returned sources", () => {
    const result = parseCachedOpenAIResearchResponse(FABRICATED_CITATION_RESPONSE, plan, {
      retrievedAt,
    });
    expect(result.registry.valid).toBe(false);
    expect(result.registry.citations).toHaveLength(0);
    expect(result.registry.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fatal: true, code: "disallowed_source_domain" }),
      ]),
    );
    expect(() =>
      parseCachedOpenAIResearchResponse(FABRICATED_CITATION_RESPONSE, plan, {
        retrievedAt,
        strict: true,
      }),
    ).toThrow(CitationIntegrityError);
  });

  it("binds one audited legacy documentation URL to the returned canonical source", () => {
    const result = parseCachedOpenAIResearchResponse(VERIFIED_ALIAS_CITATION_RESPONSE, plan, {
      retrievedAt,
      strict: true,
    });

    expect(result.registry.valid).toBe(true);
    expect(result.registry.sources).toHaveLength(1);
    expect(result.registry.sources[0]).toMatchObject({
      sourceId: "source-bd01de590b111da5",
      normalizedUrl: "https://developers.openai.com/api/docs/guides/tools-web-search",
    });
    expect(result.registry.citations[0]?.sourceId).toBe("source-bd01de590b111da5");
    expect(result.registry.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "verified_citation_url_alias",
          fatal: false,
          sourceUrl: "https://platform.openai.com/docs/guides/tools-web-search",
        }),
      ]),
    );
    expect(result.registry.sources[0]?.limitations).toEqual(
      expect.arrayContaining([expect.stringContaining("openai-web-search-guide-legacy-url-v1")]),
    );
  });

  it("keeps the same-response returned URL authoritative for the reverse alias", () => {
    const result = parseCachedOpenAIResearchResponse(
      REVERSE_VERIFIED_ALIAS_CITATION_RESPONSE,
      plan,
      { retrievedAt, strict: true },
    );

    expect(result.registry.sources).toHaveLength(1);
    expect(result.registry.sources[0]).toMatchObject({
      sourceId: "source-4450a52c5c2b1a00",
      normalizedUrl: "https://platform.openai.com/docs/guides/tools-web-search",
    });
    expect(result.registry.citations[0]?.sourceId).toBe("source-4450a52c5c2b1a00");
  });

  it.each([
    ["an unlisted legacy path", UNLISTED_PLATFORM_CITATION_RESPONSE],
    ["a semantic query difference", SEMANTIC_QUERY_ALIAS_CITATION_RESPONSE],
    ["an HTTP variant", HTTP_ALIAS_CITATION_RESPONSE],
  ])("rejects %s instead of broadening the verified alias", (_label, response) => {
    const result = parseCachedOpenAIResearchResponse(response, plan, { retrievedAt });
    expect(result.registry.valid).toBe(false);
    expect(result.registry.citations).toHaveLength(0);
    expect(result.registry.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unsupported_citation_url", fatal: true }),
      ]),
    );
  });

  it("rejects invalid citation character ranges", () => {
    const result = parseCachedOpenAIResearchResponse(INVALID_RANGE_RESPONSE, plan, {
      retrievedAt,
    });
    expect(result.registry.valid).toBe(false);
    expect(result.registry.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fatal: true, code: "invalid_annotation_range" }),
      ]),
    );
  });

  it("deduplicates canonical URLs and preserves a nonfatal metadata warning", () => {
    const result = parseCachedOpenAIResearchResponse(DUPLICATE_SOURCE_RESPONSE, plan, {
      retrievedAt,
      strict: true,
    });
    expect(result.registry.sources).toHaveLength(1);
    expect(result.registry.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fatal: false, code: "duplicate_source_metadata" }),
      ]),
    );
  });

  it("marks no-result responses as a source-policy failure", () => {
    const result = parseCachedOpenAIResearchResponse(NO_SEARCH_RESULT_RESPONSE, plan, {
      retrievedAt,
    });
    expect(result.registry.valid).toBe(false);
    expect(result.metadata.status).toBe("failed");
    expect(result.registry.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "source_count_below_minimum", fatal: true }),
      ]),
    );
  });

  it("rejects fabricated internal source IDs", () => {
    const result = parseCachedOpenAIResearchResponse(SUCCESSFUL_SOURCED_RESPONSE, plan, {
      retrievedAt,
    });
    expect(() => assertSourceReferencesExist(["source-fabricated"], result.registry)).toThrow(
      "Unsupported source reference",
    );
  });
});

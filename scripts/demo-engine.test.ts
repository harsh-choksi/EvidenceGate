import { describe, expect, it } from "vitest";

import {
  demoClaimProjections,
  demoInvariantErrorMessage,
  demoOutputDirectory,
  type DemoScenarioResult,
} from "./demo-engine.js";
import {
  createDemoResearchCorpus,
  demoFocusedSourceSearchPlan,
  demoSourceSearchPlan,
  hasCanonicalGuideCoverage,
  hasCitationPresentationCoverage,
  supportsCitationPresentationRequirement,
} from "./demo-research.js";
import { TaskSpecificationSchema } from "@evidencegate/core";
import {
  parseCachedOpenAIResearchResponse,
  type SourceResearchResult,
} from "@evidencegate/source-research";
import { readFileSync } from "node:fs";

const canonicalGuideUrl = "https://developers.openai.com/api/docs/guides/tools-web-search";
const redirectedGuideUrl = "https://developers.openai.com/docs/guides/tools-web-search";
const legacyGuideUrl = "https://platform.openai.com/docs/guides/tools-web-search";
const completeGuideCoverage = [
  "The allowed_domains setting provides domain filtering.",
  "web_search_call.action.sources returns the source list.",
  "Native url_citation annotations bind citations to returned sources.",
  "End-user citations must be clearly visible.",
  "End-user citations are required to be clickable.",
].join(" ");

function withBoundGuideNarrative(
  result: SourceResearchResult,
  narrative: string,
  normalizedUrl = canonicalGuideUrl,
): SourceResearchResult {
  const updated = structuredClone(result);
  const source = updated.registry.sources.find((item) =>
    item.normalizedUrl.includes("/guides/tools-web-search"),
  );
  if (source === undefined) throw new Error("Cached fixture is missing the Web search guide.");
  const citation = {
    citationId: "citation-guide-coverage",
    sourceId: source.sourceId,
    startIndex: 0,
    endIndex: narrative.length,
    citedText: narrative,
  };
  source.url = normalizedUrl;
  source.normalizedUrl = normalizedUrl;
  source.citationAnnotations = [citation];
  updated.narrative = narrative;
  updated.registry.citations = [citation];
  return updated;
}

describe("demo artifact isolation and diagnostics", () => {
  it("keeps live outputs beneath a separate directory", () => {
    expect(
      demoOutputDirectory("corrected", "live")
        .replaceAll("\\", "/")
        .endsWith("/.evidencegate/demo/live/corrected"),
    ).toBe(true);
    expect(
      demoOutputDirectory("corrected", "cached")
        .replaceAll("\\", "/")
        .endsWith("/.evidencegate/demo/corrected"),
    ).toBe(true);
  });

  it("reports actionable gate and artifact details for an invariant failure", () => {
    const result = {
      scenario: "corrected",
      sourceMode: "live",
      gateStatus: "fail",
      gateSummary: "fail: 10/14 required criteria verified",
      gateReasonCodes: ["required_criterion_partially_verified"],
      nonPassingCriterionIds: ["official-domains", "visible-citations"],
      bundlePath: "C:/demo/live/corrected/evidence-bundle.json",
      reportPath: "C:/demo/live/corrected/report.html",
      bundleHash: "hash",
      commandResult: {} as DemoScenarioResult["commandResult"],
      researchPassCount: 2,
      canonicalGuideCoverage: false,
    } satisfies DemoScenarioResult;

    const message = demoInvariantErrorMessage(result, "pass");
    expect(message).toContain("produced fail; expected pass");
    expect(message).toContain("official-domains, visible-citations");
    expect(message).toContain(
      "Single-guide umbrella coverage (non-gating) remained incomplete after 2 research pass(es)",
    );
    expect(message).toContain(result.bundlePath);
    expect(message).toContain(result.reportPath);
  });

  it("keeps citation parsing separate from returned-source binding", () => {
    const projection = demoClaimProjections["citation-annotations"];
    expect(projection?.internalClaim).toContain("url_citation");
    expect(projection?.internalClaim).toContain("start_index");
    expect(projection?.internalClaim).toContain("end_index");
    expect(projection?.internalClaim).not.toMatch(/bind|returned sources|source registry/iu);
    expect(demoClaimProjections["source-identifiers"]).toBeUndefined();
  });

  it("keeps the broad pass atomic and defines one focused canonical-guide follow-up", () => {
    const task = TaskSpecificationSchema.parse(
      JSON.parse(readFileSync("fixtures/demo-task.json", "utf8")),
    );
    const cachedPlan = demoSourceSearchPlan(task, "cached");
    const livePlan = demoSourceSearchPlan(task, "live");
    const focusedPlan = demoFocusedSourceSearchPlan(task);

    expect(cachedPlan.queries).toHaveLength(1);
    expect(livePlan.queries).toHaveLength(1);
    expect(focusedPlan.criterionId).toBe("responses-api");
    expect(focusedPlan.queries).toHaveLength(1);
    expect(focusedPlan.queries[0]?.query).toContain(canonicalGuideUrl);
    expect(focusedPlan.queries[0]?.query).toContain(legacyGuideUrl);
    expect(focusedPlan.queries[0]?.query).toContain("allowed_domains");
    expect(focusedPlan.queries[0]?.query).toContain("web_search_call.action.sources");
    expect(focusedPlan.queries[0]?.query).toContain("url_citation");
    expect(focusedPlan.queries[0]?.query).toContain("clearly visible and clickable");
  });

  it("does not label a negated citation-display gap as support", () => {
    const positive =
      "When showing web results, inline citations must be made clearly visible and clickable in the UI.";
    const required = "End-user citations are required to be visible and clickable.";
    const requires = "The guide requires citations to be visible and clickable.";
    const negative =
      "I did not find an official source stating that citations must be visible and clickable.";

    expect(supportsCitationPresentationRequirement(positive, "visible")).toBe(true);
    expect(supportsCitationPresentationRequirement(positive, "clickable")).toBe(true);
    expect(supportsCitationPresentationRequirement(required, "visible")).toBe(true);
    expect(supportsCitationPresentationRequirement(required, "clickable")).toBe(true);
    expect(supportsCitationPresentationRequirement(requires, "visible")).toBe(true);
    expect(supportsCitationPresentationRequirement(requires, "clickable")).toBe(true);
    expect(supportsCitationPresentationRequirement(negative, "visible")).toBe(false);
    expect(supportsCitationPresentationRequirement(negative, "clickable")).toBe(false);
  });

  it("requires every positive source-bound canonical-guide topic before skipping follow-up", () => {
    const task = TaskSpecificationSchema.parse(
      JSON.parse(readFileSync("fixtures/demo-task.json", "utf8")),
    );
    const plan = demoSourceSearchPlan(task, "cached");
    const response = JSON.parse(
      readFileSync("fixtures/cached-openai-response.json", "utf8"),
    ) as unknown;
    const result = parseCachedOpenAIResearchResponse(response, plan, {
      retrievedAt: new Date("2026-07-18T00:00:00.000Z"),
      model: "gpt-5.6-terra",
      strict: true,
    });

    const complete = withBoundGuideNarrative(result, completeGuideCoverage);
    expect(hasCanonicalGuideCoverage(complete)).toBe(true);
    expect(hasCitationPresentationCoverage(complete)).toBe(true);

    const unbound = structuredClone(complete);
    const guide = unbound.registry.sources.find((source) =>
      source.normalizedUrl.includes("/guides/tools-web-search"),
    );
    expect(guide).toBeDefined();
    guide!.citationAnnotations = [];
    expect(hasCanonicalGuideCoverage(unbound)).toBe(false);
    const invalid = structuredClone(complete);
    invalid.registry.valid = false;
    expect(hasCanonicalGuideCoverage(invalid)).toBe(false);

    const missingTopics = [
      [
        "domain filtering",
        completeGuideCoverage.replace(
          "The allowed_domains setting provides domain filtering.",
          "Search settings constrain results.",
        ),
      ],
      [
        "source list",
        completeGuideCoverage.replace(
          "web_search_call.action.sources returns the source list.",
          "The tool returns research data.",
        ),
      ],
      [
        "native annotations",
        completeGuideCoverage.replace(
          "Native url_citation annotations bind citations to returned sources.",
          "Citations can accompany the answer.",
        ),
      ],
      [
        "visible requirement",
        completeGuideCoverage.replace(
          "End-user citations must be clearly visible.",
          "End-user citations appear in the interface.",
        ),
      ],
      [
        "clickable requirement",
        completeGuideCoverage.replace(
          "End-user citations are required to be clickable.",
          "End-user citations accompany the answer.",
        ),
      ],
    ] as const;
    for (const [topic, narrative] of missingTopics) {
      expect(hasCanonicalGuideCoverage(withBoundGuideNarrative(result, narrative)), topic).toBe(
        false,
      );
    }

    const negated = completeGuideCoverage.replace(
      "The allowed_domains setting provides domain filtering.",
      "The guide does not document allowed_domains or domain filtering.",
    );
    expect(hasCanonicalGuideCoverage(withBoundGuideNarrative(result, negated))).toBe(false);
  });

  it("accepts only current allowed official canonical-guide URL equivalents", () => {
    const task = TaskSpecificationSchema.parse(
      JSON.parse(readFileSync("fixtures/demo-task.json", "utf8")),
    );
    const plan = demoSourceSearchPlan(task, "cached");
    const result = parseCachedOpenAIResearchResponse(
      JSON.parse(readFileSync("fixtures/cached-openai-response.json", "utf8")) as unknown,
      plan,
      {
        retrievedAt: new Date("2026-07-18T00:00:00.000Z"),
        model: "gpt-5.6-terra",
        strict: true,
      },
    );

    expect(
      hasCanonicalGuideCoverage(
        withBoundGuideNarrative(result, completeGuideCoverage, `${canonicalGuideUrl}/?view=full`),
      ),
    ).toBe(true);
    expect(
      hasCanonicalGuideCoverage(
        withBoundGuideNarrative(result, completeGuideCoverage, `${legacyGuideUrl}?view=full`),
      ),
    ).toBe(true);
    expect(
      hasCanonicalGuideCoverage(
        withBoundGuideNarrative(result, completeGuideCoverage, redirectedGuideUrl),
      ),
    ).toBe(true);
    const liveResponsePhrasing = completeGuideCoverage
      .replace("End-user citations must be clearly visible.", "")
      .replace(
        "End-user citations are required to be clickable.",
        "The guide expressly requires that inline citations shown to end users be clearly visible and clickable.",
      );
    expect(
      hasCanonicalGuideCoverage(
        withBoundGuideNarrative(result, liveResponsePhrasing, redirectedGuideUrl),
      ),
    ).toBe(true);
    expect(
      hasCanonicalGuideCoverage(
        withBoundGuideNarrative(result, completeGuideCoverage, `${canonicalGuideUrl}/other`),
      ),
    ).toBe(false);

    const disqualifiedSources = [
      { name: "disallowed", update: { allowedByPolicy: false } },
      { name: "unofficial", update: { isOfficial: false } },
      { name: "wrong source type", update: { sourceType: "unknown" as const } },
      { name: "not current", update: { freshnessStatus: "unknown" as const } },
    ];
    for (const { name, update } of disqualifiedSources) {
      const candidate = withBoundGuideNarrative(result, completeGuideCoverage);
      const source = candidate.registry.sources.find((item) =>
        item.normalizedUrl.includes("/guides/tools-web-search"),
      );
      expect(source).toBeDefined();
      Object.assign(source!, update);
      expect(hasCanonicalGuideCoverage(candidate), name).toBe(false);
    }
  });

  it("rejects every plan/result provenance mismatch before constructing a corpus", () => {
    const task = TaskSpecificationSchema.parse(
      JSON.parse(readFileSync("fixtures/demo-task.json", "utf8")),
    );
    const plan = demoSourceSearchPlan(task, "live");
    const result = parseCachedOpenAIResearchResponse(
      JSON.parse(readFileSync("fixtures/cached-openai-response.json", "utf8")) as unknown,
      plan,
      {
        retrievedAt: new Date("2026-07-18T00:00:00.000Z"),
        model: "gpt-5.6-terra",
        strict: true,
      },
    );
    const mismatches: Array<{
      name: string;
      mutate: (candidate: SourceResearchResult) => void;
      message: string;
    }> = [
      {
        name: "criterion ID",
        mutate: (candidate) => {
          candidate.metadata.criterionIds = ["other-criterion"];
        },
        message: "Research pass 1 (primary) criterion metadata mismatch",
      },
      {
        name: "extra criterion ID",
        mutate: (candidate) => {
          candidate.metadata.criterionIds = [plan.criterionId, "other-criterion"];
        },
        message: "Research pass 1 (primary) criterion metadata mismatch",
      },
      {
        name: "queries",
        mutate: (candidate) => {
          candidate.metadata.queries = ["different query"];
        },
        message: "Research pass 1 (primary) queries metadata mismatch",
      },
      {
        name: "allowed domains",
        mutate: (candidate) => {
          candidate.metadata.allowedDomains = ["developers.openai.com"];
        },
        message: "Research pass 1 (primary) allowed domains metadata mismatch",
      },
      {
        name: "blocked domains",
        mutate: (candidate) => {
          candidate.metadata.blockedDomains = ["example.com"];
        },
        message: "Research pass 1 (primary) blocked domains metadata mismatch",
      },
    ];

    for (const mismatch of mismatches) {
      const candidate = structuredClone(result);
      mismatch.mutate(candidate);
      expect(
        () =>
          createDemoResearchCorpus([
            {
              kind: "primary",
              criterionIds: [plan.criterionId],
              plan,
              result: candidate,
            },
          ]),
        mismatch.name,
      ).toThrow(mismatch.message);
    }

    expect(() =>
      createDemoResearchCorpus([
        {
          kind: "primary",
          criterionIds: ["other-criterion"],
          plan,
          result,
        },
      ]),
    ).toThrow("Research pass 1 (primary) criterion scope mismatch");
  });

  it("merges two native-cited passes with shifted ranges and unique provenance", () => {
    const task = TaskSpecificationSchema.parse(
      JSON.parse(readFileSync("fixtures/demo-task.json", "utf8")),
    );
    const primaryPlan = demoSourceSearchPlan(task, "live");
    const focusedPlan = demoFocusedSourceSearchPlan(task);
    const raw = readFileSync("fixtures/cached-openai-response.json", "utf8");
    const primary = parseCachedOpenAIResearchResponse(JSON.parse(raw) as unknown, primaryPlan, {
      retrievedAt: new Date("2026-07-18T00:00:00.000Z"),
      model: "gpt-5.6-terra",
      strict: true,
    });
    const focusedResponse = JSON.parse(
      raw
        .replaceAll("resp_cached_evidencegate_demo", "resp_cached_evidencegate_focus")
        .replaceAll("ws_cached_openai_docs", "ws_cached_openai_focus"),
    ) as unknown;
    const focused = parseCachedOpenAIResearchResponse(focusedResponse, focusedPlan, {
      retrievedAt: new Date("2026-07-18T00:00:01.000Z"),
      model: "gpt-5.6-terra",
      strict: true,
    });
    const criterionIds = task.acceptanceCriteria
      .filter((criterion) => criterion.evidenceDomain === "hybrid")
      .map((criterion) => criterion.criterionId);
    const corpus = createDemoResearchCorpus([
      { kind: "primary", criterionIds, plan: primaryPlan, result: primary },
      { kind: "focused-followup", criterionIds, plan: focusedPlan, result: focused },
    ]);

    const primaryPrefix = "Research pass 1 - primary\n";
    const focusedPrefix = "Research pass 2 - focused-followup\n";
    expect(corpus.merged.narrative).toBe(
      `${primaryPrefix}${primary.narrative}\n\n${focusedPrefix}${focused.narrative}`,
    );
    const primaryOriginalCitation = primary.registry.citations[0]!;
    const focusedOriginalCitation = focused.registry.citations[0]!;
    const mergedPrimaryCitation = corpus.merged.registry.citations.find(
      (citation) => citation.citationId === `citation-p1-${primaryOriginalCitation.citationId}`,
    );
    const mergedFocusedCitation = corpus.merged.registry.citations.find(
      (citation) => citation.citationId === `citation-p2-${focusedOriginalCitation.citationId}`,
    );
    expect(mergedPrimaryCitation?.startIndex).toBe(
      primaryPrefix.length + primaryOriginalCitation.startIndex!,
    );
    expect(mergedFocusedCitation?.startIndex).toBe(
      primaryPrefix.length +
        primary.narrative.length +
        2 +
        focusedPrefix.length +
        focusedOriginalCitation.startIndex!,
    );
    expect(corpus.merged.registry.sources).toHaveLength(2);
    expect(corpus.merged.registry.citations).toHaveLength(4);
    expect(corpus.merged.metadata.webSearchCallIds).toEqual([
      "ws_cached_openai_docs",
      "ws_cached_openai_focus",
    ]);
    expect(new Set(corpus.merged.registry.citations.map((item) => item.citationId)).size).toBe(4);
    expect(
      corpus.merged.registry.sources.find((source) =>
        source.normalizedUrl.includes("tools-web-search"),
      )?.webSearchCallIds,
    ).toEqual(["ws_cached_openai_docs", "ws_cached_openai_focus"]);
    for (const citation of corpus.merged.registry.citations) {
      expect(citation.startIndex).toBeDefined();
      expect(citation.endIndex).toBeDefined();
      expect(corpus.merged.narrative.slice(citation.startIndex, citation.endIndex)).toBe(
        citation.citedText,
      );
    }
    expect(() =>
      createDemoResearchCorpus([
        { kind: "primary", criterionIds, plan: primaryPlan, result: primary },
        { kind: "focused-followup", criterionIds, plan: focusedPlan, result: focused },
        { kind: "focused-followup", criterionIds, plan: focusedPlan, result: focused },
      ]),
    ).toThrow("at most one focused research follow-up");
  });
});

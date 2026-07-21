import { createHash } from "node:crypto";

import type { TaskSpecification } from "@evidencegate/core";
import { extractCitedNarrativeContexts } from "@evidencegate/openai";
import {
  assertValidSourceRegistry,
  createSourceSearchPlan,
  detectSourceConflicts,
  type SourceResearchResult,
  type SourceSearchPlan,
} from "@evidencegate/source-research";

export interface DemoResearchPass {
  kind: "primary" | "focused-followup";
  criterionIds: readonly string[];
  plan: SourceSearchPlan;
  result: SourceResearchResult;
}

export interface DemoResearchCorpus {
  merged: SourceResearchResult;
  passes: readonly DemoResearchPass[];
  candidateCriterionIdsBySourceId: ReadonlyMap<string, readonly string[]>;
}

const canonicalWebSearchGuideUrl = "https://developers.openai.com/api/docs/guides/tools-web-search";
const redirectedWebSearchGuideUrl = "https://developers.openai.com/docs/guides/tools-web-search";
const legacyWebSearchGuideUrl = "https://platform.openai.com/docs/guides/tools-web-search";

export function demoSourceSearchPlan(
  task: TaskSpecification,
  mode: "cached" | "live",
): SourceSearchPlan {
  return createSourceSearchPlan({
    criterionId: "responses-api",
    externalClaim:
      "The current OpenAI Responses API supports the web_search tool, official-domain filters, the consulted-source list through web_search_call.action.sources, URL citation annotations, and requires user-facing citations to be visible and clickable.",
    productOrStandard: "OpenAI Responses API",
    version: "current as of 2026-07-18",
    dateSensitivity: "current API behavior",
    requireUserApproval: true,
    sourcePolicyOverrides: {
      allowedDomains: ["developers.openai.com", "platform.openai.com"],
      minimumSourceCount: 1,
      // Responses web-search source metadata commonly omits publication dates
      // for canonical documentation. Live mode records an explicit
      // non-restrictive freshness policy instead of fabricating a source date.
      maxSourceAgeDays: mode === "live" ? null : 30,
    },
    privateIdentifiers: [task.taskId],
  });
}

export function demoFocusedSourceSearchPlan(task: TaskSpecification): SourceSearchPlan {
  const plan = createSourceSearchPlan({
    criterionId: "responses-api",
    externalClaim:
      "The current official OpenAI Web search guide documents the Responses API web_search tool, allowed-domain filters, the consulted sources list through web_search_call.action.sources, native URL citation annotations, and the requirement that end-user citations be clearly visible and clickable.",
    productOrStandard: "OpenAI Web search guide",
    version: "current as of 2026-07-18",
    dateSensitivity: "current API behavior",
    requireUserApproval: true,
    sourcePolicyOverrides: {
      allowedDomains: ["developers.openai.com", "platform.openai.com"],
      minimumSourceCount: 1,
      maxSourceAgeDays: null,
    },
    privateIdentifiers: [task.taskId],
  });
  return {
    ...plan,
    queries: [
      {
        query: `${canonicalWebSearchGuideUrl} (legacy equivalent: ${legacyWebSearchGuideUrl}) allowed_domains web_search_call.action.sources url_citation "clearly visible and clickable"`,
        purpose:
          "Open the canonical Web search guide (using the audited legacy URL only as its equivalent fallback), find the domain-filtering, source-list, native URL-citation, and visible/clickable citation passages, and bind each conclusion to that returned guide source.",
        warnings: [],
      },
    ],
  };
}

function uniqueInOrder(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function orderedValuesMatch(expected: readonly string[], received: readonly string[]): boolean {
  return (
    expected.length === received.length &&
    expected.every((value, index) => value === received[index])
  );
}

function assertResearchPassMatchesPlan(pass: DemoResearchPass, passIndex: number): void {
  const label = `Research pass ${passIndex + 1} (${pass.kind})`;
  const metadata = pass.result.metadata;
  const expectedCriterionIds = [pass.plan.criterionId];
  if (!orderedValuesMatch(expectedCriterionIds, metadata.criterionIds)) {
    throw new Error(
      `${label} criterion metadata mismatch: expected ${JSON.stringify(expectedCriterionIds)}; received ${JSON.stringify(metadata.criterionIds)}.`,
    );
  }
  if (!pass.criterionIds.includes(pass.plan.criterionId)) {
    throw new Error(
      `${label} criterion scope mismatch: pass criterion IDs ${JSON.stringify(pass.criterionIds)} do not include plan criterion ID ${JSON.stringify(pass.plan.criterionId)}.`,
    );
  }

  const comparisons = [
    {
      name: "queries",
      expected: pass.plan.queries.map((query) => query.query),
      received: metadata.queries,
    },
    {
      name: "allowed domains",
      expected: pass.plan.allowedDomains,
      received: metadata.allowedDomains,
    },
    {
      name: "blocked domains",
      expected: pass.plan.blockedDomains,
      received: metadata.blockedDomains,
    },
  ] as const;
  for (const comparison of comparisons) {
    if (!orderedValuesMatch(comparison.expected, comparison.received)) {
      throw new Error(
        `${label} ${comparison.name} metadata mismatch: expected ${JSON.stringify(comparison.expected)}; received ${JSON.stringify(comparison.received)}.`,
      );
    }
  }
}

function sourceMetadataConflict(
  field: string,
  left: string | undefined,
  right: string | undefined,
): string[] {
  return left !== undefined && right !== undefined && left !== right
    ? [
        `Repeated live research returned conflicting ${field} metadata; the first value was retained.`,
      ]
    : [];
}

function freshnessRank(
  status: SourceResearchResult["registry"]["sources"][number]["freshnessStatus"],
): number {
  return { current: 0, possibly_stale: 1, unknown: 2, stale: 3 }[status];
}

function mergeResearchSourceRecords(
  existing: SourceResearchResult["registry"]["sources"][number],
  incoming: SourceResearchResult["registry"]["sources"][number],
): SourceResearchResult["registry"]["sources"][number] {
  if (
    existing.sourceId !== incoming.sourceId ||
    existing.normalizedUrl !== incoming.normalizedUrl
  ) {
    throw new Error("Research source identity collision while merging live passes.");
  }

  const publisher = existing.publisher ?? incoming.publisher;
  const publishedAt = existing.publishedAt ?? incoming.publishedAt;
  const updatedAt = existing.updatedAt ?? incoming.updatedAt;
  const contentHash = existing.contentHash ?? incoming.contentHash;
  const freshnessStatus =
    freshnessRank(existing.freshnessStatus) >= freshnessRank(incoming.freshnessStatus)
      ? existing.freshnessStatus
      : incoming.freshnessStatus;
  const metadataLimitations = [
    ...sourceMetadataConflict("title", existing.title, incoming.title),
    ...sourceMetadataConflict("publisher", existing.publisher, incoming.publisher),
    ...sourceMetadataConflict("publication date", existing.publishedAt, incoming.publishedAt),
    ...sourceMetadataConflict("update date", existing.updatedAt, incoming.updatedAt),
    ...sourceMetadataConflict("content hash", existing.contentHash, incoming.contentHash),
  ];

  return {
    ...existing,
    webSearchCallIds: uniqueInOrder([
      ...(existing.webSearchCallIds ?? [existing.webSearchCallId]),
      ...(incoming.webSearchCallIds ?? [incoming.webSearchCallId]),
    ]),
    ...(publisher === undefined ? {} : { publisher }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    retrievedAt:
      Date.parse(existing.retrievedAt) <= Date.parse(incoming.retrievedAt)
        ? existing.retrievedAt
        : incoming.retrievedAt,
    sourceType: existing.sourceType === incoming.sourceType ? existing.sourceType : "unknown",
    isPrimary: existing.isPrimary && incoming.isPrimary,
    isOfficial: existing.isOfficial && incoming.isOfficial,
    allowedByPolicy: existing.allowedByPolicy && incoming.allowedByPolicy,
    freshnessStatus,
    ...(contentHash === undefined ? {} : { contentHash }),
    citationAnnotations: [...existing.citationAnnotations, ...incoming.citationAnnotations],
    claimsSupported: uniqueInOrder([...existing.claimsSupported, ...incoming.claimsSupported]),
    claimsContradicted: uniqueInOrder([
      ...existing.claimsContradicted,
      ...incoming.claimsContradicted,
    ]),
    limitations: uniqueInOrder([
      ...existing.limitations,
      ...incoming.limitations,
      ...metadataLimitations,
    ]).sort(),
  };
}

function remappedCitationId(passIndex: number, citationId: string): string {
  return `citation-p${passIndex + 1}-${citationId}`;
}

export function createDemoResearchCorpus(passes: readonly DemoResearchPass[]): DemoResearchCorpus {
  if (passes.length === 0) throw new Error("At least one research pass is required.");
  if (passes.length > 2) {
    throw new Error("The packaged demo permits at most one focused research follow-up.");
  }
  if (
    passes[0]?.kind !== "primary" ||
    (passes[1] !== undefined && passes[1].kind !== "focused-followup")
  ) {
    throw new Error("Research passes must contain one primary pass followed by one focused pass.");
  }

  for (const [passIndex, pass] of passes.entries()) {
    assertResearchPassMatchesPlan(pass, passIndex);
  }

  const candidateSets = new Map<string, Set<string>>();
  for (const pass of passes) {
    for (const source of pass.result.registry.sources) {
      const candidates = candidateSets.get(source.sourceId) ?? new Set<string>();
      for (const criterionId of pass.criterionIds) candidates.add(criterionId);
      candidateSets.set(source.sourceId, candidates);
    }
  }
  const candidateCriterionIdsBySourceId = new Map(
    [...candidateSets].map(
      ([sourceId, criterionIds]) => [sourceId, [...criterionIds].sort()] as const,
    ),
  );

  if (passes.length === 1) {
    return {
      merged: passes[0].result,
      passes,
      candidateCriterionIdsBySourceId,
    };
  }

  const models = uniqueInOrder(passes.map((pass) => pass.result.metadata.model));
  if (models.length !== 1) throw new Error("Research passes must use the same model.");
  const allCallIds = passes.flatMap((pass) => pass.result.metadata.webSearchCallIds);
  if (uniqueInOrder(allCallIds).length !== allCallIds.length) {
    throw new Error("Research passes returned a duplicate web-search call ID.");
  }

  let narrative = "";
  const sourcesByUrl = new Map<string, SourceResearchResult["registry"]["sources"][number]>();
  const issues: SourceResearchResult["registry"]["issues"] = [];
  for (const [passIndex, pass] of passes.entries()) {
    const separator = narrative === "" ? "" : "\n\n";
    const passHeading = `Research pass ${passIndex + 1} - ${pass.kind}`;
    const passPrefix = `${passHeading}\n`;
    const narrativeOffset = narrative.length + separator.length + passPrefix.length;
    narrative += `${separator}${passPrefix}${pass.result.narrative}`;
    for (const issue of pass.result.registry.issues) {
      issues.push({ ...issue, message: `[research pass ${passIndex + 1}] ${issue.message}` });
    }
    for (const source of pass.result.registry.sources) {
      const citationAnnotations = source.citationAnnotations.map((citation) => {
        const shifted = {
          ...citation,
          citationId: remappedCitationId(passIndex, citation.citationId),
          ...(citation.startIndex === undefined
            ? {}
            : { startIndex: citation.startIndex + narrativeOffset }),
          ...(citation.endIndex === undefined
            ? {}
            : { endIndex: citation.endIndex + narrativeOffset }),
        };
        if (
          shifted.startIndex !== undefined &&
          shifted.endIndex !== undefined &&
          shifted.citedText !== undefined &&
          narrative.slice(shifted.startIndex, shifted.endIndex) !== shifted.citedText
        ) {
          throw new Error(`Citation ${shifted.citationId} no longer binds after merge.`);
        }
        return shifted;
      });
      const shiftedSource = { ...source, citationAnnotations };
      const existing = sourcesByUrl.get(source.normalizedUrl);
      sourcesByUrl.set(
        source.normalizedUrl,
        existing === undefined
          ? shiftedSource
          : mergeResearchSourceRecords(existing, shiftedSource),
      );
    }
  }

  const sources = [...sourcesByUrl.values()];
  const citations = sources.flatMap((source) => source.citationAnnotations);
  if (uniqueInOrder(citations.map((citation) => citation.citationId)).length !== citations.length) {
    throw new Error("Research-pass citation IDs were not globally unique after merge.");
  }
  const valid =
    passes.every((pass) => pass.result.registry.valid) && !issues.some((issue) => issue.fatal);
  const registry = { sources, citations, issues, valid };
  assertValidSourceRegistry(registry);
  const researchRunSeed = passes.map((pass) => pass.result.metadata.researchRunId).join("\0");
  const merged: SourceResearchResult = {
    narrative,
    registry,
    conflicts: detectSourceConflicts(sources),
    metadata: {
      researchRunId: `research-${createHash("sha256").update(researchRunSeed).digest("hex").slice(0, 16)}`,
      criterionIds: uniqueInOrder(passes.flatMap((pass) => [...pass.criterionIds])).sort(),
      model: models[0]!,
      webSearchCallIds: allCallIds,
      queries: passes.flatMap((pass) => pass.result.metadata.queries),
      allowedDomains: uniqueInOrder(
        passes.flatMap((pass) => pass.result.metadata.allowedDomains),
      ).sort(),
      blockedDomains: uniqueInOrder(
        passes.flatMap((pass) => pass.result.metadata.blockedDomains),
      ).sort(),
      startedAt: passes.map((pass) => pass.result.metadata.startedAt).sort()[0]!,
      completedAt: passes
        .map((pass) => pass.result.metadata.completedAt)
        .sort()
        .at(-1)!,
      sourceCount: sources.length,
      citationCount: citations.length,
      status: passes.every((pass) => pass.result.metadata.status === "completed")
        ? "completed"
        : sources.length > 0
          ? "partial"
          : "failed",
    },
  };
  return { merged, passes, candidateCriterionIdsBySourceId };
}

const coverageNegation =
  /\b(?:cannot|can't|did not|didn't|does not|doesn't|no|not|unable to|unsupported|without)\b/iu;

function hasPositiveBoundContext(citedContext: string, requirement: RegExp): boolean {
  return citedContext.split(/(?:[.!?](?:\s+|$)|\n+)/u).some((sentence) => {
    return requirement.test(sentence) && !coverageNegation.test(sentence);
  });
}

function normalizeGuideUrlForCoverage(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.hash !== "") return undefined;
    parsed.search = "";
    const pathname = parsed.pathname.replace(/\/+$/u, "");
    return `${parsed.origin}${pathname}`;
  } catch {
    return undefined;
  }
}

export function hasCanonicalGuideCoverage(result: SourceResearchResult): boolean {
  if (!result.registry.valid) return false;
  const acceptedGuideUrls = new Set(
    [canonicalWebSearchGuideUrl, redirectedWebSearchGuideUrl, legacyWebSearchGuideUrl].map((url) =>
      normalizeGuideUrlForCoverage(url),
    ),
  );
  return result.registry.sources.some((source) => {
    if (
      !acceptedGuideUrls.has(normalizeGuideUrlForCoverage(source.normalizedUrl)) ||
      !source.allowedByPolicy ||
      !source.isOfficial ||
      source.sourceType !== "official_documentation" ||
      source.freshnessStatus !== "current"
    ) {
      return false;
    }
    const contexts = extractCitedNarrativeContexts(
      result.narrative,
      source.citationAnnotations,
    ).join("\n");
    return (
      hasPositiveBoundContext(
        contexts,
        /\b(?:allowed_domains|allowed domains?|domain filters?|domain filtering)\b/iu,
      ) &&
      hasPositiveBoundContext(
        contexts,
        /\b(?:web_search_call\.action\.sources|action\.sources|sources? list|list of (?:all |consulted |returned )?sources)\b/iu,
      ) &&
      hasPositiveBoundContext(
        contexts,
        /\b(?:url_citation|url[ -]citation annotations?|native (?:url[ -])?citation annotations?)\b/iu,
      ) &&
      supportsCitationPresentationRequirement(contexts, "visible") &&
      supportsCitationPresentationRequirement(contexts, "clickable")
    );
  });
}

export const hasCitationPresentationCoverage = hasCanonicalGuideCoverage;

export function supportsCitationPresentationRequirement(
  citedContext: string,
  presentation: "visible" | "clickable",
): boolean {
  return citedContext.split(/(?:[.!?](?:\s+|$)|\n+)/u).some((sentence) => {
    return (
      /\bcitations?\b/iu.test(sentence) &&
      /\b(?:must|required|requires?)\b/iu.test(sentence) &&
      new RegExp(`\\b${presentation}\\b`, "iu").test(sentence) &&
      !coverageNegation.test(sentence)
    );
  });
}

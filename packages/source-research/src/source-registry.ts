import { parseOpenAIWebSearchResponse, type ReturnedApiSource } from "./citation-parser.js";
import { findVerifiedCitationUrlAlias } from "./citation-url-aliases.js";
import { evaluateFreshness } from "./freshness.js";
import { classifySourceAuthority, evaluateSourceAgainstPolicy } from "./source-policy.js";
import { normalizeSourceUrl, validateSourceUrl } from "./url-validator.js";
import type {
  CitationAnnotation,
  CitationIntegrityIssue,
  CitationIntegrityIssueCode,
  ExternalSourceRecord,
  SourceRegistry,
  SourceSearchPlan,
} from "./types.js";

function stableHash(value: string, seed: number): string {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function sourceIdForNormalizedUrl(normalizedUrl: string): string {
  return `source-${stableHash(normalizedUrl, 0x811c9dc5)}${stableHash(normalizedUrl, 0x9e3779b9)}`;
}

function urlIssueCode(code: string): CitationIntegrityIssueCode {
  switch (code) {
    case "blocked_domain":
      return "blocked_source_domain";
    case "disallowed_domain":
      return "disallowed_source_domain";
    case "redirect_domain_bypass":
      return "redirect_domain_bypass";
    default:
      return "unsafe_source_url";
  }
}

function pushMetadataConflict(
  issues: CitationIntegrityIssue[],
  source: ExternalSourceRecord,
  description: string,
): void {
  const limitation = `Duplicate returned source had conflicting ${description}.`;
  if (!source.limitations.includes(limitation)) {
    source.limitations.push(limitation);
  }
  issues.push({
    code: "duplicate_source_metadata",
    message: `${source.sourceId}: ${limitation}`,
    fatal: false,
    sourceUrl: source.url,
  });
}

function mergeReturnedSource(
  existing: ExternalSourceRecord,
  incoming: ReturnedApiSource,
  issues: CitationIntegrityIssue[],
): void {
  const callIds = new Set(existing.webSearchCallIds ?? [existing.webSearchCallId]);
  callIds.add(incoming.webSearchCallId);
  existing.webSearchCallIds = [...callIds];

  for (const field of ["title", "publisher", "publishedAt", "updatedAt"] as const) {
    const incomingValue = incoming[field];
    if (incomingValue === undefined) continue;
    const existingValue = existing[field];
    if (existingValue === undefined || existingValue === "") {
      existing[field] = incomingValue;
    } else if (existingValue !== incomingValue) {
      pushMetadataConflict(issues, existing, `${field} metadata`);
    }
  }
}

function isFreshnessLimitation(limitation: string): boolean {
  return (
    limitation.startsWith("Source publication freshness") ||
    limitation.startsWith("Source exceeds the configured freshness") ||
    limitation.startsWith("Source is near or beyond the configured freshness") ||
    limitation.startsWith("Source is stale under the configured freshness")
  );
}

export interface BuildSourceRegistryResult {
  responseId?: string;
  narrative: string;
  webSearchCallIds: string[];
  registry: SourceRegistry;
}

interface CitationSourceBinding {
  source: ExternalSourceRecord;
  aliasRuleId?: string;
}

function findCitationSourceBinding(
  sourcesByNormalizedUrl: ReadonlyMap<string, ExternalSourceRecord>,
  citationNormalizedUrl: string,
): CitationSourceBinding | undefined {
  const exact = sourcesByNormalizedUrl.get(citationNormalizedUrl);
  if (exact !== undefined) return { source: exact };

  const aliasMatches = [...sourcesByNormalizedUrl.values()].flatMap((source) => {
    const alias = findVerifiedCitationUrlAlias(citationNormalizedUrl, source.normalizedUrl);
    return alias === undefined ? [] : [{ source, aliasRuleId: alias.ruleId }];
  });
  return aliasMatches.length === 1 ? aliasMatches[0] : undefined;
}

export function buildSourceRegistry(
  response: unknown,
  plan: SourceSearchPlan,
  retrievedAt: Date = new Date(),
): BuildSourceRegistryResult {
  const parsed = parseOpenAIWebSearchResponse(response);
  const issues = [...parsed.issues];
  const byNormalizedUrl = new Map<string, ExternalSourceRecord>();

  for (const returned of parsed.returnedSources) {
    const validated = validateSourceUrl(
      returned.url,
      plan.sourcePolicy.allowedDomainRules,
      plan.sourcePolicy.blockedDomainRules,
    );
    if (!validated.valid) {
      issues.push({
        code: urlIssueCode(validated.code),
        message: validated.message,
        fatal: true,
        sourceUrl: returned.url,
      });
      continue;
    }

    const existing = byNormalizedUrl.get(validated.normalizedUrl);
    if (existing !== undefined) {
      issues.push({
        code: "duplicate_source_metadata",
        message: `Duplicate source URL was deduplicated: ${validated.normalizedUrl}`,
        fatal: false,
        sourceUrl: returned.url,
      });
      mergeReturnedSource(existing, returned, issues);
      continue;
    }

    const freshness = evaluateFreshness({
      ...(returned.publishedAt === undefined ? {} : { publishedAt: returned.publishedAt }),
      ...(returned.updatedAt === undefined ? {} : { updatedAt: returned.updatedAt }),
      retrievedAt: retrievedAt.toISOString(),
      maxSourceAgeDays: plan.maxSourceAgeDays,
      asOf: retrievedAt,
    });
    const authority = classifySourceAuthority({
      url: validated.normalizedUrl,
      policy: plan.sourcePolicy,
      ...(returned.declaredSourceType === undefined
        ? {}
        : { declaredSourceType: returned.declaredSourceType }),
      freshnessStatus: freshness.status,
    });
    const source: ExternalSourceRecord = {
      sourceId: sourceIdForNormalizedUrl(validated.normalizedUrl),
      webSearchCallId: returned.webSearchCallId,
      webSearchCallIds: [returned.webSearchCallId],
      url: returned.url,
      normalizedUrl: validated.normalizedUrl,
      title: returned.title?.trim() || validated.hostname,
      domain: validated.hostname,
      ...(returned.publisher === undefined ? {} : { publisher: returned.publisher }),
      ...(returned.publishedAt === undefined ? {} : { publishedAt: returned.publishedAt }),
      ...(returned.updatedAt === undefined ? {} : { updatedAt: returned.updatedAt }),
      retrievedAt: retrievedAt.toISOString(),
      sourceType: authority.sourceType,
      isPrimary: authority.isPrimary,
      isOfficial: authority.isOfficial,
      allowedByPolicy: authority.domainAllowed,
      freshnessStatus: freshness.status,
      citationAnnotations: [],
      claimsSupported: [],
      claimsContradicted: [],
      limitations: [...authority.limitations],
    };
    const policyEvaluation = evaluateSourceAgainstPolicy(source, plan.sourcePolicy);
    source.allowedByPolicy = policyEvaluation.accepted;
    for (const reason of policyEvaluation.reasons) {
      if (!source.limitations.includes(reason)) source.limitations.push(reason);
    }
    byNormalizedUrl.set(validated.normalizedUrl, source);
  }

  // Duplicate records can contribute publication metadata. Re-evaluate after
  // all duplicates have been merged so freshness and policy decisions reflect
  // the complete returned metadata rather than whichever record appeared first.
  for (const source of byNormalizedUrl.values()) {
    const freshness = evaluateFreshness({
      ...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt }),
      ...(source.updatedAt === undefined ? {} : { updatedAt: source.updatedAt }),
      retrievedAt: source.retrievedAt,
      maxSourceAgeDays: plan.maxSourceAgeDays,
      asOf: retrievedAt,
    });
    const authority = classifySourceAuthority({
      url: source.normalizedUrl,
      policy: plan.sourcePolicy,
      declaredSourceType: source.sourceType,
      freshnessStatus: freshness.status,
    });
    source.sourceType = authority.sourceType;
    source.isPrimary = authority.isPrimary;
    source.isOfficial = authority.isOfficial;
    source.freshnessStatus = freshness.status;
    source.limitations = source.limitations.filter(
      (limitation) => !isFreshnessLimitation(limitation),
    );
    for (const limitation of authority.limitations) {
      if (!source.limitations.includes(limitation)) {
        source.limitations.push(limitation);
      }
    }
    const policyEvaluation = evaluateSourceAgainstPolicy(source, plan.sourcePolicy);
    source.allowedByPolicy = policyEvaluation.accepted;
    for (const reason of policyEvaluation.reasons) {
      if (!source.limitations.includes(reason)) source.limitations.push(reason);
    }
  }

  const citations: CitationAnnotation[] = [];
  for (const parsedCitation of parsed.urlCitations) {
    const validated = validateSourceUrl(
      parsedCitation.url,
      plan.sourcePolicy.allowedDomainRules,
      plan.sourcePolicy.blockedDomainRules,
    );
    if (!validated.valid) {
      issues.push({
        code:
          validated.code === "blocked_domain"
            ? "blocked_source_domain"
            : validated.code === "disallowed_domain"
              ? "disallowed_source_domain"
              : validated.code === "redirect_domain_bypass"
                ? "redirect_domain_bypass"
                : "invalid_citation_url",
        message: `Citation URL failed validation: ${validated.message}`,
        fatal: true,
        sourceUrl: parsedCitation.url,
        citationIndex: parsedCitation.annotationIndex,
      });
      continue;
    }

    const binding = findCitationSourceBinding(byNormalizedUrl, validated.normalizedUrl);
    if (binding === undefined) {
      issues.push({
        code: "unsupported_citation_url",
        message:
          "Citation URL was not present in any same-response search source or direct open/find action URL and was rejected.",
        fatal: true,
        sourceUrl: parsedCitation.url,
        citationIndex: parsedCitation.annotationIndex,
      });
      continue;
    }
    const { source } = binding;

    if (binding.aliasRuleId !== undefined) {
      const limitation =
        `Citation URL ${validated.normalizedUrl} was bound to returned source ` +
        `${source.normalizedUrl} using verified alias rule ${binding.aliasRuleId}.`;
      if (!source.limitations.includes(limitation)) {
        source.limitations.push(limitation);
      }
      issues.push({
        code: "verified_citation_url_alias",
        message: limitation,
        fatal: false,
        sourceUrl: parsedCitation.url,
        citationIndex: parsedCitation.annotationIndex,
      });
    }

    if (
      parsedCitation.title !== undefined &&
      source.title !== source.domain &&
      parsedCitation.title.trim() !== source.title
    ) {
      pushMetadataConflict(issues, source, "citation title");
    } else if (parsedCitation.title !== undefined && source.title === source.domain) {
      source.title = parsedCitation.title.trim();
    }

    const citation: CitationAnnotation = {
      citationId: `citation-${parsedCitation.annotationIndex + 1}`,
      sourceId: source.sourceId,
      startIndex: parsedCitation.startIndex,
      endIndex: parsedCitation.endIndex,
      citedText: parsedCitation.citedText,
    };
    citations.push(citation);
    source.citationAnnotations.push(citation);
  }

  const sources = [...byNormalizedUrl.values()];
  const acceptedSourceCount = sources.filter((source) => source.allowedByPolicy).length;
  if (acceptedSourceCount > 0 && parsed.narrative.trim() === "") {
    issues.push({
      code: "invalid_response_shape",
      message: "Web-search sources were returned without a research narrative.",
      fatal: true,
    });
  }
  if (acceptedSourceCount > 0 && citations.length === 0) {
    issues.push({
      code: "missing_citation_annotations",
      message:
        "Web-search sources were returned without URL citation annotations in the research narrative.",
      fatal: true,
    });
  }
  if (acceptedSourceCount < plan.minimumSourceCount) {
    issues.push({
      code: "source_count_below_minimum",
      message: `Source policy requires ${plan.minimumSourceCount} accepted source(s), but ${acceptedSourceCount} were returned.`,
      fatal: true,
    });
  }

  const registry: SourceRegistry = {
    sources,
    citations,
    issues,
    valid: !issues.some((issue) => issue.fatal),
  };

  return {
    ...(parsed.responseId === undefined ? {} : { responseId: parsed.responseId }),
    narrative: parsed.narrative,
    webSearchCallIds: parsed.webSearchCallIds,
    registry,
  };
}

export function findSourceByUrl(
  registry: SourceRegistry,
  url: string,
): ExternalSourceRecord | undefined {
  const normalized = normalizeSourceUrl(url);
  if (!normalized.valid) return undefined;
  return registry.sources.find((source) => source.normalizedUrl === normalized.normalizedUrl);
}

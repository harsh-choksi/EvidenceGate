import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { EvidenceGateConfig } from "@evidencegate/config";
import {
  CURRENT_GATE_POLICY_VERSION,
  ExternalSourceRecordSchema,
  ResearchRunMetadataSchema,
  createEvidenceBundle,
  deriveCombinedStatus,
  evaluateGate,
  resolveGatePolicy,
  sha256Canonical,
  type AcceptanceCriterion,
  type CombinedClaimAssessment,
  type EvidenceBundle,
  type EvidenceItem,
  type ExternalClaimAssessment,
  type ExternalSourceRecord,
  type GatePolicy,
  type InternalClaimAssessment,
  type ResolvedEvidenceDomain,
  type SourceMode,
  type TaskSpecification,
} from "@evidencegate/core";
import {
  collectRepositorySnapshot,
  type RepositorySnapshot as GitRepositorySnapshot,
} from "@evidencegate/git";
import {
  redactSecrets,
  runCommands,
  type CommandResult,
  type CommandSpec,
} from "@evidencegate/runner";
import {
  SOURCE_POLICY_NAMES,
  SOURCE_TYPES,
  classifySourceAuthority,
  createOpenAIOfficialSourcePolicy,
  createSourcePolicy,
  createSourceSearchPlan,
  detectSourceConflicts,
  evaluateFreshness,
  evaluateSourceAgainstPolicy,
  redactSensitiveText,
  researchStatusForRegistry,
  sourceIdForNormalizedUrl,
  validateSourceRegistry,
  validateSourceUrl,
  type CitationIntegrityIssue,
  type ExternalSourceRecord as ResearchSourceRecord,
  type SourceResearchResult,
  type SourceSearchPlan,
} from "@evidencegate/source-research";
import { z } from "zod";

export const APPROVED_SOURCE_ARTIFACT_TYPE = "evidencegate.approved-source-results" as const;
export const DEFAULT_SOURCE_RESULTS_PATH = ".evidencegate/sources/latest.json" as const;
export const DEFAULT_BUNDLE_PATH = ".evidencegate/evidence-bundle.json" as const;

export interface ApprovedSourceResultsArtifact {
  schemaVersion: 1;
  artifactType: typeof APPROVED_SOURCE_ARTIFACT_TYPE;
  taskId: string;
  taskHash: string;
  configHash: string;
  planHash: string;
  resultHash: string;
  bindingMethod: "stage_a_native_citation";
  approved: true;
  approvedAt: string;
  plans: SourceSearchPlan[];
  results: SourceResearchResult[];
}

const sourceTypeSchema = z.enum(SOURCE_TYPES);
const sourcePolicyNameSchema = z.enum(SOURCE_POLICY_NAMES);
const freshnessStatusSchema = z.enum(["current", "possibly_stale", "stale", "unknown"]);
const citationIssueCodeSchema = z.enum([
  "invalid_response_shape",
  "missing_source_url",
  "unsafe_source_url",
  "blocked_source_domain",
  "disallowed_source_domain",
  "redirect_domain_bypass",
  "invalid_annotation_range",
  "missing_citation_annotations",
  "unsupported_citation_url",
  "invalid_citation_url",
  "duplicate_source_metadata",
  "source_count_below_minimum",
]);

const domainRuleSchema = z
  .object({ hostname: z.string().min(1), includeSubdomains: z.boolean() })
  .strict();
const sourcePolicyConfigSchema = z
  .object({
    name: sourcePolicyNameSchema,
    allowedDomains: z.array(z.string().min(1)),
    blockedDomains: z.array(z.string().min(1)),
    allowedDomainRules: z.array(domainRuleSchema),
    blockedDomainRules: z.array(domainRuleSchema),
    minimumSourceCount: z.number().int().nonnegative(),
    maxSourceAgeDays: z.number().nonnegative().nullable(),
    requiredSourceTypes: z.array(sourceTypeSchema),
    jurisdiction: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
  })
  .strict();
const sourceSearchPlanSchema = z
  .object({
    criterionId: z.string().min(1),
    normalizedExternalClaim: z.string().min(1),
    queries: z.array(
      z
        .object({
          query: z.string().min(1),
          purpose: z.string().min(1),
          warnings: z.array(z.string()),
        })
        .strict(),
    ),
    sourcePolicy: sourcePolicyConfigSchema,
    allowedDomains: z.array(z.string().min(1)),
    blockedDomains: z.array(z.string().min(1)),
    maxSourceAgeDays: z.number().nonnegative().nullable(),
    minimumSourceCount: z.number().int().nonnegative(),
    rationale: z.string().min(1),
    requiresUserApproval: z.boolean(),
    privacyWarnings: z.array(z.string()),
  })
  .strict();
const researchCitationSchema = z
  .object({
    citationId: z.string().min(1),
    sourceId: z.string().min(1),
    startIndex: z.number().int().nonnegative().optional(),
    endIndex: z.number().int().positive().optional(),
    citedText: z.string().optional(),
  })
  .strict();
const researchSourceSchema = z
  .object({
    sourceId: z.string().min(1),
    webSearchCallId: z.string().min(1),
    webSearchCallIds: z.array(z.string().min(1)).optional(),
    url: z.string().min(1),
    normalizedUrl: z.string().min(1),
    title: z.string().min(1),
    domain: z.string().min(1),
    publisher: z.string().min(1).optional(),
    publishedAt: z.string().min(1).optional(),
    updatedAt: z.string().min(1).optional(),
    retrievedAt: z.string().datetime({ offset: true }),
    sourceType: sourceTypeSchema,
    isPrimary: z.boolean(),
    isOfficial: z.boolean(),
    allowedByPolicy: z.boolean(),
    freshnessStatus: freshnessStatusSchema,
    contentHash: z.string().min(1).optional(),
    citationAnnotations: z.array(researchCitationSchema),
    claimsSupported: z.array(z.string().min(1)),
    claimsContradicted: z.array(z.string().min(1)),
    limitations: z.array(z.string()),
  })
  .strict();
const citationIssueSchema = z
  .object({
    code: citationIssueCodeSchema,
    message: z.string().min(1),
    fatal: z.boolean(),
    sourceUrl: z.string().min(1).optional(),
    citationIndex: z.number().int().nonnegative().optional(),
  })
  .strict();
const sourceConflictSchema = z
  .object({
    conflictId: z.string().min(1),
    normalizedClaim: z.string().min(1),
    supportingSourceIds: z.array(z.string().min(1)),
    contradictingSourceIds: z.array(z.string().min(1)),
    reason: z.string().min(1),
    requiresManualReview: z.boolean(),
  })
  .strict();
const sourceResearchResultSchema = z
  .object({
    narrative: z.string(),
    registry: z
      .object({
        sources: z.array(researchSourceSchema),
        citations: z.array(researchCitationSchema),
        issues: z.array(citationIssueSchema),
        valid: z.boolean(),
      })
      .strict(),
    conflicts: z.array(sourceConflictSchema),
    metadata: ResearchRunMetadataSchema,
    rawResponseId: z.string().min(1).optional(),
  })
  .strict();

const approvedSourceArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    artifactType: z.literal(APPROVED_SOURCE_ARTIFACT_TYPE),
    taskId: z.string().min(1),
    taskHash: z.string().regex(/^[a-f0-9]{64}$/u),
    configHash: z.string().regex(/^[a-f0-9]{64}$/u),
    planHash: z.string().regex(/^[a-f0-9]{64}$/u),
    resultHash: z.string().regex(/^[a-f0-9]{64}$/u),
    bindingMethod: z.literal("stage_a_native_citation"),
    approved: z.literal(true),
    approvedAt: z.string().datetime({ offset: true }),
    plans: z.array(sourceSearchPlanSchema),
    results: z.array(sourceResearchResultSchema),
  })
  .strict();

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}_${sha256Canonical(value).slice(0, 20)}`;
}

function isOpenAIClaim(criterion: AcceptanceCriterion): boolean {
  return /\b(?:openai|chatgpt|codex|responses api|gpt-)\b/iu.test(criterion.text);
}

export function resolveEvidenceDomain(criterion: AcceptanceCriterion): ResolvedEvidenceDomain {
  if (criterion.evidenceDomain !== "auto") return criterion.evidenceDomain;
  if (criterion.category === "external_fact" || criterion.category === "standards") {
    return "external";
  }
  if (
    criterion.externalEvidence?.mode === "requested" ||
    criterion.externalEvidence?.mode === "required"
  ) {
    return "hybrid";
  }
  return "internal";
}

function criterionUsesExternalEvidence(criterion: AcceptanceCriterion): boolean {
  if (criterion.externalEvidence?.mode === "off") return false;
  const domain = resolveEvidenceDomain(criterion);
  return domain === "external" || domain === "hybrid";
}

function matchingConfiguredPolicy(
  criterion: AcceptanceCriterion,
  policyName: NonNullable<TaskSpecification["defaultSourcePolicy"]>,
  config: EvidenceGateConfig,
): EvidenceGateConfig["sources"]["policies"][string] | undefined {
  const exact = config.sources.policies[policyName];
  if (exact !== undefined) return exact;
  const matches = Object.entries(config.sources.policies)
    .filter(([, policy]) => policy.sourcePolicy === policyName)
    .sort(([left], [right]) => left.localeCompare(right));
  if (matches.length === 1) return matches[0]?.[1];
  if (isOpenAIClaim(criterion)) {
    return matches.find(([name]) => /openai/iu.test(name))?.[1];
  }
  return undefined;
}

function planForCriterion(
  task: TaskSpecification,
  criterion: AcceptanceCriterion,
  config: EvidenceGateConfig,
): SourceSearchPlan {
  const policyName =
    criterion.externalEvidence?.sourcePolicy ??
    task.defaultSourcePolicy ??
    config.sources.defaultPolicy;
  const configuredPolicy = matchingConfiguredPolicy(criterion, policyName, config);
  const allowedDomains =
    criterion.externalEvidence?.allowedDomains ?? configuredPolicy?.allowedDomains;
  const blockedDomains = uniqueSorted([
    ...(configuredPolicy?.blockedDomains ?? []),
    ...(criterion.externalEvidence?.blockedDomains ?? []),
  ]);
  const minimumSourceCount =
    criterion.externalEvidence?.minimumSourceCount ??
    configuredPolicy?.minimumSourceCount ??
    config.sources.minimumSourceCount;
  const maxSourceAgeDays =
    criterion.externalEvidence?.maxSourceAgeDays ?? configuredPolicy?.maxSourceAgeDays;
  const policyOverrides = {
    ...(allowedDomains === undefined ? {} : { allowedDomains }),
    ...(blockedDomains.length === 0 ? {} : { blockedDomains }),
    minimumSourceCount,
    ...(maxSourceAgeDays === undefined ? {} : { maxSourceAgeDays }),
  };
  const sourcePolicy =
    policyName === "official_only" && isOpenAIClaim(criterion) && allowedDomains === undefined
      ? createOpenAIOfficialSourcePolicy(policyOverrides)
      : createSourcePolicy(policyName, policyOverrides);
  const basePlan = createSourceSearchPlan({
    criterionId: criterion.criterionId,
    externalClaim: criterion.text,
    sourcePolicy,
    dateSensitivity:
      sourcePolicy.maxSourceAgeDays === null ? "no freshness limit" : "current requirement",
    requireUserApproval: config.sources.previewRequired,
  });

  const userQuery = criterion.externalEvidence?.userQuery;
  const preferredPublishers = criterion.externalEvidence?.preferredPublishers ?? [];
  const withPublisherPreference: SourceSearchPlan =
    preferredPublishers.length === 0
      ? basePlan
      : {
          ...basePlan,
          rationale: `${basePlan.rationale} Prefer sources published by: ${preferredPublishers.join(", ")}. Publisher preference does not replace domain, authority, citation, or freshness validation.`,
          privacyWarnings: uniqueSorted([
            ...basePlan.privacyWarnings,
            `Publisher preference sent with this claim: ${preferredPublishers.join(", ")}.`,
          ]),
        };
  if (userQuery === undefined) return withPublisherPreference;
  const redaction = redactSensitiveText(userQuery, {
    redactEmails: true,
    redactCodeBlocks: true,
    maximumLength: 500,
  });
  if (redaction.text === "") {
    throw new Error(`Criterion ${criterion.criterionId} has an empty userQuery after redaction.`);
  }
  return {
    ...withPublisherPreference,
    queries: [
      {
        query: redaction.text,
        purpose: "Run the task author's explicit, privacy-redacted source query.",
        warnings: redaction.findings.map(
          (finding) => `Removed ${finding.kind.replaceAll("_", " ")} from the explicit query.`,
        ),
      },
    ].slice(0, config.sources.maximumSearchQueriesPerClaim),
    privacyWarnings: uniqueSorted([
      ...withPublisherPreference.privacyWarnings,
      ...redaction.findings.map(
        (finding) => `Removed ${finding.kind.replaceAll("_", " ")} from the explicit query.`,
      ),
    ]),
  };
}

export interface BuildSourcePlansOptions {
  selectedCriterionIds?: readonly string[];
  forExecution?: boolean;
}

export function buildSourcePlans(
  task: TaskSpecification,
  config: EvidenceGateConfig,
  options: BuildSourcePlansOptions = {},
): SourceSearchPlan[] {
  if (task.sourceMode === "off" || config.sources.mode === "off") return [];
  const eligible = task.acceptanceCriteria.filter(criterionUsesExternalEvidence);
  const selected = new Set(options.selectedCriterionIds ?? []);

  for (const criterionId of selected) {
    const criterion = task.acceptanceCriteria.find((item) => item.criterionId === criterionId);
    if (criterion === undefined) throw new Error(`Unknown criterion selection: ${criterionId}`);
    if (!criterionUsesExternalEvidence(criterion)) {
      throw new Error(`Criterion ${criterionId} does not use external evidence.`);
    }
  }
  if (options.forExecution === true && task.sourceMode === "requested" && selected.size === 0) {
    throw new Error(
      "sourceMode=requested requires at least one explicit --criterion selection before searching.",
    );
  }

  const chosen = eligible.filter(
    (criterion) => selected.size === 0 || selected.has(criterion.criterionId),
  );
  if (chosen.length > config.sources.maximumClaimsPerRun) {
    throw new Error(
      `The source plan contains ${chosen.length} claims, exceeding maximumClaimsPerRun=${config.sources.maximumClaimsPerRun}. Select fewer criteria explicitly.`,
    );
  }
  return chosen.map((criterion) => planForCriterion(task, criterion, config));
}

const SEMANTIC_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "should",
  "that",
  "the",
  "this",
  "to",
  "use",
  "using",
  "was",
  "were",
  "with",
]);
const GENERIC_SEMANTIC_TOKENS = new Set([
  "api",
  "current",
  "documentation",
  "official",
  "openai",
  "requirement",
  "source",
  "support",
  "supported",
  "tool",
  "product",
  "version",
]);
const CONTRADICTION_PATTERN =
  /\b(?:cannot|can't|does not support|do not support|no longer|is deprecated|are deprecated|is unsupported|are unsupported|was removed|has been removed|prohibited|forbidden|contradicts?)\b/iu;

function semanticToken(token: string): string {
  const normalized = token.normalize("NFKC").toLocaleLowerCase();
  if (normalized.length > 5 && /(?:ches|shes|xes|zes)$/u.test(normalized)) {
    return normalized.slice(0, -2);
  }
  return normalized.length > 4 && normalized.endsWith("s") ? normalized.slice(0, -1) : normalized;
}

function semanticTokens(value: string): string[] {
  return uniqueSorted(
    (value.match(/[\p{L}\p{N}]{2,}/gu) ?? [])
      .map(semanticToken)
      .filter((token) => token.length >= 3 && !SEMANTIC_STOP_WORDS.has(token)),
  );
}

function citedTextCoversPlan(citedText: string, plan: SourceSearchPlan): boolean {
  const claimTokens = semanticTokens(plan.normalizedExternalClaim);
  const fallbackTokens = uniqueSorted(plan.queries.flatMap((query) => semanticTokens(query.query)));
  const requiredTokens = claimTokens.length > 0 ? claimTokens : fallbackTokens;
  if (requiredTokens.length === 0) return false;
  const observed = new Set(semanticTokens(citedText));
  const matched = requiredTokens.filter((token) => observed.has(token));
  const minimumMatches =
    requiredTokens.length === 1
      ? 1
      : requiredTokens.length <= 5
        ? 2
        : Math.min(4, Math.ceil(requiredTokens.length * 0.35));
  if (matched.length < minimumMatches) return false;
  const anchors = requiredTokens.filter((token) => !GENERIC_SEMANTIC_TOKENS.has(token));
  return anchors.length === 0 || anchors.some((token) => observed.has(token));
}

function assertCanonicalPlanSubset(
  task: TaskSpecification,
  config: EvidenceGateConfig,
  plans: readonly SourceSearchPlan[],
): void {
  const canonical = new Map(
    buildSourcePlans(task, config).map((plan) => [plan.criterionId, plan] as const),
  );
  const seen = new Set<string>();
  for (const plan of plans) {
    if (seen.has(plan.criterionId)) {
      throw new Error(`Approved source plans contain duplicate criterion: ${plan.criterionId}`);
    }
    seen.add(plan.criterionId);
    const expected = canonical.get(plan.criterionId);
    if (expected === undefined || !isDeepStrictEqual(plan, expected)) {
      throw new Error(
        `Approved source plan does not exactly match the current task/config policy: ${plan.criterionId}`,
      );
    }
  }
}

function sortedCitations(
  citations: readonly ResearchSourceRecord["citationAnnotations"][number][],
): ResearchSourceRecord["citationAnnotations"] {
  return [...citations].sort((left, right) => left.citationId.localeCompare(right.citationId));
}

function revalidateResearchResult(
  input: SourceResearchResult,
  plan: SourceSearchPlan,
): SourceResearchResult {
  const result = sourceResearchResultSchema.parse(input) as unknown as SourceResearchResult;
  if (!isDeepStrictEqual(result.metadata.criterionIds, [plan.criterionId])) {
    throw new Error(
      `Research result must bind to exactly its approved criterion: ${plan.criterionId}`,
    );
  }
  const expectedQueries = plan.queries.map((query) => query.query);
  if (!isDeepStrictEqual(result.metadata.queries, expectedQueries)) {
    throw new Error(
      `Research metadata queries do not match the approved plan: ${plan.criterionId}`,
    );
  }
  if (
    !isDeepStrictEqual(result.metadata.allowedDomains, plan.allowedDomains) ||
    !isDeepStrictEqual(result.metadata.blockedDomains, plan.blockedDomains)
  ) {
    throw new Error(
      `Research metadata domains do not match the approved plan: ${plan.criterionId}`,
    );
  }

  const normalizedSources = result.registry.sources.map((source): ResearchSourceRecord => {
    const validatedUrl = validateSourceUrl(
      source.url,
      plan.sourcePolicy.allowedDomainRules,
      plan.sourcePolicy.blockedDomainRules,
    );
    if (!validatedUrl.valid) {
      throw new Error(`Stored source failed current URL/domain policy: ${validatedUrl.message}`);
    }
    const expectedSourceId = sourceIdForNormalizedUrl(validatedUrl.normalizedUrl);
    if (source.sourceId !== expectedSourceId) {
      throw new Error(
        `Stored source ID does not match its canonical URL: ${source.sourceId} !== ${expectedSourceId}`,
      );
    }
    if (
      source.normalizedUrl !== validatedUrl.normalizedUrl ||
      source.domain !== validatedUrl.hostname
    ) {
      throw new Error(`Stored source URL metadata is not canonical: ${source.sourceId}`);
    }
    for (const citation of source.citationAnnotations) {
      if (citation.sourceId !== source.sourceId) {
        throw new Error(`Citation ${citation.citationId} is attached to the wrong source.`);
      }
      if (
        citation.startIndex === undefined ||
        citation.endIndex === undefined ||
        citation.citedText === undefined ||
        citation.endIndex > result.narrative.length ||
        result.narrative.slice(citation.startIndex, citation.endIndex) !== citation.citedText
      ) {
        throw new Error(
          `Citation ${citation.citationId} does not exactly bind to its stored research narrative.`,
        );
      }
    }

    const freshness = evaluateFreshness({
      ...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt }),
      ...(source.updatedAt === undefined ? {} : { updatedAt: source.updatedAt }),
      retrievedAt: source.retrievedAt,
      maxSourceAgeDays: plan.maxSourceAgeDays,
      asOf: new Date(source.retrievedAt),
    });
    const authority = classifySourceAuthority({
      url: validatedUrl.normalizedUrl,
      policy: plan.sourcePolicy,
      declaredSourceType: source.sourceType,
      freshnessStatus: freshness.status,
    });
    const policyCandidate: ResearchSourceRecord = {
      ...source,
      normalizedUrl: validatedUrl.normalizedUrl,
      domain: validatedUrl.hostname,
      sourceType: authority.sourceType,
      isPrimary: authority.isPrimary,
      isOfficial: authority.isOfficial,
      allowedByPolicy: false,
      freshnessStatus: freshness.status,
      claimsSupported: [],
      claimsContradicted: [],
    };
    const policyEvaluation = evaluateSourceAgainstPolicy(policyCandidate, plan.sourcePolicy);
    const citedText = source.citationAnnotations
      .map((citation) => citation.citedText ?? "")
      .filter(Boolean)
      .join(" ");
    const semanticallyBound = citedTextCoversPlan(citedText, plan);
    const contradicts = semanticallyBound && CONTRADICTION_PATTERN.test(citedText);
    const limitations = uniqueSorted([
      ...source.limitations,
      ...authority.limitations,
      ...policyEvaluation.reasons,
      ...(freshness.status === "current" ? [] : [freshness.explanation]),
      ...(semanticallyBound
        ? [
            contradicts
              ? "Validated native citation text semantically contradicts this criterion."
              : "Validated native citation text contains criterion-specific support.",
          ]
        : [
            "Native citation text did not contain enough criterion-specific terms to claim support.",
          ]),
    ]);
    return {
      ...policyCandidate,
      allowedByPolicy: policyEvaluation.accepted,
      claimsSupported: semanticallyBound && !contradicts ? [plan.criterionId] : [],
      claimsContradicted: contradicts ? [plan.criterionId] : [],
      limitations,
    };
  });

  const citations = sortedCitations(
    normalizedSources.flatMap((source) => source.citationAnnotations),
  );
  if (!isDeepStrictEqual(citations, sortedCitations(result.registry.citations))) {
    throw new Error(`Research citation registry does not exactly match source annotations.`);
  }
  const structuralIssues = validateSourceRegistry({
    sources: normalizedSources,
    citations,
    issues: [],
    valid: true,
  });
  if (structuralIssues.some((issue) => issue.fatal)) {
    throw new Error(
      `Stored source registry failed structural validation: ${structuralIssues
        .filter((issue) => issue.fatal)
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }

  const acceptedSourceCount = normalizedSources.filter((source) => source.allowedByPolicy).length;
  const recomputedIssues: CitationIntegrityIssue[] = [...result.registry.issues];
  if (acceptedSourceCount > 0 && result.narrative.trim() === "") {
    recomputedIssues.push({
      code: "invalid_response_shape",
      message: "Validated sources require a non-empty research narrative.",
      fatal: true,
    });
  }
  if (acceptedSourceCount > 0 && citations.length === 0) {
    recomputedIssues.push({
      code: "missing_citation_annotations",
      message: "Validated sources require native citation annotations.",
      fatal: true,
    });
  }
  if (acceptedSourceCount < plan.minimumSourceCount) {
    recomputedIssues.push({
      code: "source_count_below_minimum",
      message: `Source policy requires ${plan.minimumSourceCount} accepted source(s), but ${acceptedSourceCount} remain after revalidation.`,
      fatal: true,
    });
  }
  const issues = recomputedIssues.filter(
    (issue, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.code === issue.code &&
          candidate.message === issue.message &&
          candidate.sourceUrl === issue.sourceUrl &&
          candidate.citationIndex === issue.citationIndex,
      ) === index,
  );
  const valid = !issues.some((issue) => issue.fatal);
  const expectedCallIds = uniqueSorted(
    normalizedSources.flatMap((source) => [
      source.webSearchCallId,
      ...(source.webSearchCallIds ?? []),
    ]),
  );
  if (!isDeepStrictEqual(uniqueSorted(result.metadata.webSearchCallIds), expectedCallIds)) {
    throw new Error(`Research metadata call IDs do not match its source registry.`);
  }
  if (
    result.metadata.sourceCount !== normalizedSources.length ||
    result.metadata.citationCount !== citations.length
  ) {
    throw new Error(`Research metadata counts do not match its source/citation registry.`);
  }
  const expectedStatus = researchStatusForRegistry(valid, normalizedSources.length);
  if (result.metadata.status !== expectedStatus) {
    throw new Error(`Research source metadata status does not match its revalidated registry.`);
  }
  const conflicts = detectSourceConflicts(normalizedSources);
  return {
    ...result,
    registry: { sources: normalizedSources, citations, issues, valid },
    conflicts,
  };
}

type ApprovedSourceArtifactPayload = Omit<ApprovedSourceResultsArtifact, "resultHash">;

function approvedSourceResultHash(payload: ApprovedSourceArtifactPayload): string {
  return sha256Canonical(payload);
}

export function computeApprovedSourceResultHash(
  input: ApprovedSourceArtifactPayload | ApprovedSourceResultsArtifact,
): string {
  const payload = { ...input } as Partial<ApprovedSourceResultsArtifact>;
  delete payload.resultHash;
  return approvedSourceResultHash(payload as ApprovedSourceArtifactPayload);
}

export function createApprovedSourceResultsArtifact(
  task: TaskSpecification,
  config: EvidenceGateConfig,
  plans: SourceSearchPlan[],
  results: SourceResearchResult[],
  approvedAt = new Date().toISOString(),
): ApprovedSourceResultsArtifact {
  const validatedPlans = z.array(sourceSearchPlanSchema).parse(plans) as SourceSearchPlan[];
  assertCanonicalPlanSubset(task, config, validatedPlans);
  const planByCriterion = new Map(validatedPlans.map((plan) => [plan.criterionId, plan] as const));
  const boundResults = results.map((result): SourceResearchResult => {
    const candidate = sourceResearchResultSchema.parse(result) as unknown as SourceResearchResult;
    if (candidate.metadata.criterionIds.length !== 1) {
      throw new Error(
        "Stage-A citation binding requires each research result to cover exactly one approved criterion.",
      );
    }
    const criterionId = candidate.metadata.criterionIds[0]!;
    const plan = planByCriterion.get(criterionId);
    if (plan === undefined) {
      throw new Error(`Research result is not covered by an approved plan: ${criterionId}`);
    }
    return revalidateResearchResult(candidate, plan);
  });
  const payload: ApprovedSourceArtifactPayload = {
    schemaVersion: 1,
    artifactType: APPROVED_SOURCE_ARTIFACT_TYPE,
    taskId: task.taskId,
    taskHash: sha256Canonical(task),
    configHash: sha256Canonical(config),
    planHash: sha256Canonical(validatedPlans),
    bindingMethod: "stage_a_native_citation",
    approved: true,
    approvedAt,
    plans: validatedPlans,
    results: boundResults,
  };
  const artifact: ApprovedSourceResultsArtifact = {
    ...payload,
    resultHash: approvedSourceResultHash(payload),
  };
  return approvedSourceArtifactSchema.parse(artifact) as unknown as ApprovedSourceResultsArtifact;
}

export function parseApprovedSourceResultsArtifact(
  value: unknown,
  task: TaskSpecification,
  config: EvidenceGateConfig,
): ApprovedSourceResultsArtifact {
  const parsed = approvedSourceArtifactSchema.parse(
    value,
  ) as unknown as ApprovedSourceResultsArtifact;
  if (parsed.taskId !== task.taskId || parsed.taskHash !== sha256Canonical(task)) {
    throw new Error("Approved source results do not belong to the current task specification.");
  }
  if (parsed.configHash !== sha256Canonical(config)) {
    throw new Error(
      "Approved source results were created under a different .evidencegate.yml policy.",
    );
  }
  if (parsed.planHash !== sha256Canonical(parsed.plans)) {
    throw new Error("Approved source plan hash does not match the stored plan.");
  }
  const { resultHash, ...payload } = parsed;
  if (resultHash !== approvedSourceResultHash(payload)) {
    throw new Error("Approved source result hash does not match the complete stored payload.");
  }
  assertCanonicalPlanSubset(task, config, parsed.plans);
  const planByCriterion = new Map(parsed.plans.map((plan) => [plan.criterionId, plan] as const));
  const revalidatedResults = parsed.results.map((result) => {
    if (result.metadata.criterionIds.length !== 1) {
      throw new Error(
        "Stage-A citation binding requires each research result to cover exactly one approved criterion.",
      );
    }
    const criterionId = result.metadata.criterionIds[0]!;
    const plan = planByCriterion.get(criterionId);
    if (plan === undefined) {
      throw new Error(`Research result is not covered by an approved plan: ${criterionId}`);
    }
    return revalidateResearchResult(result, plan);
  });
  if (!isDeepStrictEqual(revalidatedResults, parsed.results)) {
    throw new Error(
      "Approved source results changed under current URL, citation, freshness, or source-policy validation.",
    );
  }
  return { ...parsed, results: revalidatedResults };
}

function globToRegExp(glob: string): RegExp {
  const normalized = glob.replaceAll("\\", "/").replace(/^\.\//u, "");
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    const next = normalized[index + 1];
    if (character === "*" && next === "*") {
      const followedBySlash = normalized[index + 2] === "/";
      expression += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 2 : 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character === undefined ? "" : character.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  return new RegExp(`${expression}$`, "u");
}

function matchesAny(filePath: string, patterns: readonly string[]): boolean {
  const normalized = filePath.replaceAll("\\", "/").replace(/^\.\//u, "");
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}

export function isPathInScope(
  filePath: string,
  task: TaskSpecification,
  config: EvidenceGateConfig,
): boolean {
  const included = task.includePaths;
  if (included !== undefined && included.length > 0 && !matchesAny(filePath, included))
    return false;
  const excluded = [...(task.excludePaths ?? []), ...config.privacy.excludedPaths];
  return !matchesAny(filePath, excluded);
}

const CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
  ".vue",
  ".svelte",
]);
const CONFIG_EXTENSIONS = new Set([".json", ".jsonc", ".toml", ".yaml", ".yml"]);
const REQUIREMENT_FILE_NAMES = new Set([
  "evidencegate.task.json",
  ".evidencegate.yml",
  ".evidencegate.yaml",
]);

function stripSlashComments(value: string): string {
  let result = "";
  let state: "normal" | "single" | "double" | "template" | "line" | "block" = "normal";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    const next = value[index + 1] ?? "";
    if (state === "line") {
      if (character === "\n") {
        result += character;
        state = "normal";
      } else {
        result += " ";
      }
      continue;
    }
    if (state === "block") {
      if (character === "*" && next === "/") {
        result += "  ";
        state = "normal";
        index += 1;
      } else {
        result += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state === "normal" && character === "/" && next === "/") {
      result += "  ";
      state = "line";
      index += 1;
      continue;
    }
    if (state === "normal" && character === "/" && next === "*") {
      result += "  ";
      state = "block";
      index += 1;
      continue;
    }
    result += character;
    if (character === "\\" && state !== "normal") {
      result += next;
      index += 1;
      continue;
    }
    if (state === "normal") {
      if (character === "'") state = "single";
      else if (character === '"') state = "double";
      else if (character === "`") state = "template";
    } else if (
      (state === "single" && character === "'") ||
      (state === "double" && character === '"') ||
      (state === "template" && character === "`")
    ) {
      state = "normal";
    }
  }
  return result;
}

function searchableContent(filePath: string, content: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (CODE_EXTENSIONS.has(extension)) {
    if (extension === ".py" || extension === ".rb") {
      return content
        .split(/\r?\n/u)
        .map((line) => line.replace(/(^|\s)#.*$/u, "$1"))
        .join("\n");
    }
    return stripSlashComments(content).replace(/<!--[\s\S]*?-->/gu, " ");
  }
  if (CONFIG_EXTENSIONS.has(extension)) return content;
  return content.replace(/<!--[\s\S]*?-->/gu, " ");
}

function hintTokens(hint: string): string[] {
  return hint.match(/[A-Za-z_$][A-Za-z0-9_$-]{2,}/gu) ?? [];
}

function findHint(content: string, hint: string): number {
  const tokens = hintTokens(hint);
  if (tokens.length === 0) return -1;
  let offset = 0;
  let first = -1;
  const lower = content.toLowerCase();
  for (const token of tokens) {
    const index = lower.indexOf(token.toLowerCase(), offset);
    if (index < 0 || (first >= 0 && index - first > 240)) return -1;
    if (first < 0) first = index;
    offset = index + token.length;
  }
  return first;
}

interface ScannedFile {
  path: string;
  content: string;
}

export interface HintAnalysisResult {
  filesScanned: number;
  evidence: EvidenceItem[];
  assessments: InternalClaimAssessment[];
  warnings: string[];
}

function safeReadChangedFiles(repositoryRoot: string, paths: readonly string[]): ScannedFile[] {
  const root = realpathSync(repositoryRoot);
  const files: ScannedFile[] = [];
  for (const relativePath of paths) {
    if (REQUIREMENT_FILE_NAMES.has(relativePath.toLowerCase())) continue;
    const absolute = path.resolve(root, relativePath);
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    try {
      const real = realpathSync(absolute);
      const realRelative = path.relative(root, real);
      const stats = statSync(real);
      if (
        realRelative.startsWith("..") ||
        path.isAbsolute(realRelative) ||
        !stats.isFile() ||
        stats.size > 500_000
      ) {
        continue;
      }
      files.push({
        path: relativePath.replaceAll("\\", "/"),
        content: readFileSync(real, "utf8"),
      });
    } catch {
      // Deleted, unreadable, and non-text changed files cannot establish positive evidence.
    }
  }
  return files;
}

function eligibleForCriterion(file: ScannedFile, criterion: AcceptanceCriterion): boolean {
  const extension = path.extname(file.path).toLowerCase();
  if (criterion.category === "documentation") return extension === ".md" || extension === ".mdx";
  if (extension === ".md" || extension === ".mdx") return false;
  if (criterion.category === "testing") {
    return (
      CODE_EXTENSIONS.has(extension) &&
      /(?:^|\/)(?:test|tests|__tests__)(?:\/|\.)|\.(?:test|spec)\./u.test(file.path)
    );
  }
  return CODE_EXTENSIONS.has(extension) || CONFIG_EXTENSIONS.has(extension);
}

export function analyzeRepositoryWithHints(
  repositoryRoot: string,
  criteria: readonly AcceptanceCriterion[],
  changedPaths: readonly string[],
  capturedAt: string,
): HintAnalysisResult {
  const files = safeReadChangedFiles(repositoryRoot, changedPaths);
  const evidence: EvidenceItem[] = [];
  const assessments: InternalClaimAssessment[] = [];

  for (const criterion of criteria) {
    const domain = resolveEvidenceDomain(criterion);
    if (domain === "external") {
      assessments.push({
        criterionId: criterion.criterionId,
        normalizedClaim: criterion.text,
        status: "not_applicable",
        supportingEvidenceIds: [],
        contradictingEvidenceIds: [],
        missingEvidence: [],
        explanation: "This criterion is evaluated only against external-source evidence.",
      });
      continue;
    }

    const hints = criterion.verificationHints ?? [];
    const matchedEvidenceIds: string[] = [];
    let matchedHints = 0;
    for (const hint of hints) {
      let match: { file: ScannedFile; index: number; searchable: string } | undefined;
      for (const file of files.filter((candidate) => eligibleForCriterion(candidate, criterion))) {
        const searchable = searchableContent(file.path, file.content);
        const index = findHint(searchable, hint);
        if (index >= 0) {
          match = { file, index, searchable };
          break;
        }
      }
      if (match === undefined) continue;
      matchedHints += 1;
      const excerpt = match.searchable
        .slice(Math.max(0, match.index - 80), match.index + hint.length + 140)
        .replace(/\s+/gu, " ")
        .trim();
      const evidenceId = stableId("evidence", [
        criterion.criterionId,
        hint,
        match.file.path,
        excerpt,
      ]);
      if (!matchedEvidenceIds.includes(evidenceId)) matchedEvidenceIds.push(evidenceId);
      if (!evidence.some((item) => item.evidenceId === evidenceId)) {
        evidence.push({
          evidenceId,
          criterionIds: [criterion.criterionId],
          kind:
            criterion.category === "documentation"
              ? "documentation"
              : CONFIG_EXTENSIONS.has(path.extname(match.file.path).toLowerCase())
                ? "configuration"
                : "source_file",
          status: "informational",
          summary: `Verification hint found in changed file: ${hint}`,
          details: excerpt,
          filePath: match.file.path,
          capturedAt,
          contentHash: hashText(match.file.content),
        });
      }
    }

    const complete = hints.length > 0 && matchedHints === hints.length;
    const partial = matchedHints > 0;
    assessments.push({
      criterionId: criterion.criterionId,
      normalizedClaim: criterion.text,
      status: complete ? "verified" : partial ? "partially_verified" : "unsupported",
      supportingEvidenceIds: matchedEvidenceIds,
      contradictingEvidenceIds: [],
      missingEvidence: complete
        ? []
        : hints.length === 0
          ? ["A criterion-specific verificationHint and matching executable/configuration evidence"]
          : hints.filter(
              (hint) =>
                !files
                  .filter((file) => eligibleForCriterion(file, criterion))
                  .some((file) => findHint(searchableContent(file.path, file.content), hint) >= 0),
            ),
      explanation: complete
        ? "Every configured verification hint was found in eligible changed code, tests, or configuration."
        : partial
          ? "Only some configured verification hints were found in eligible changed files."
          : hints.length === 0
            ? "No deterministic verification hint is configured; arbitrary prose is not treated as proof."
            : "No configured verification hint was found in eligible changed code, tests, or configuration.",
    });
  }

  return {
    filesScanned: files.length,
    evidence,
    assessments,
    warnings: [
      "Hint matching is bounded to in-scope changed files; comments and general prose do not prove implementation claims.",
    ],
  };
}

function commandEvidenceKind(commandId: string): EvidenceItem["kind"] {
  const normalized = commandId.toLowerCase();
  if (normalized.includes("test")) return "test_result";
  if (normalized.includes("lint")) return "lint_result";
  if (normalized.includes("type")) return "typecheck_result";
  if (normalized.includes("build")) return "build_result";
  if (normalized.includes("security") || normalized.includes("audit")) return "security_result";
  return "runtime_probe";
}

function evidenceStatusForCommand(result: CommandResult): EvidenceItem["status"] {
  if (result.status === "passed") return "passed";
  if (result.status === "spawn_error") return "unavailable";
  return "failed";
}

function commandResultToEvidence(
  result: CommandResult,
  criterionIds: string[],
  required: boolean,
): EvidenceItem {
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return {
    evidenceId: stableId("command", [result.commandId, result.command, result.startedAt]),
    criterionIds,
    kind: commandEvidenceKind(result.commandId),
    status: evidenceStatusForCommand(result),
    summary: `${result.commandId} ${result.status} with exit code ${result.exitCode ?? "unavailable"}.`,
    ...(output === "" ? {} : { details: redactSecrets(output) }),
    required,
    command: result.command,
    capturedAt: result.completedAt,
    contentHash: hashText(output),
    metadata: {
      commandId: result.commandId,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      outputTruncated: result.outputTruncated,
    },
  };
}

function mergeInternalCommandEvidence(
  task: TaskSpecification,
  assessments: InternalClaimAssessment[],
  commandEvidence: EvidenceItem[],
): InternalClaimAssessment[] {
  const passedTests = commandEvidence.filter(
    (item) => item.kind === "test_result" && item.status === "passed",
  );
  return assessments.map((assessment) => {
    const criterion = task.acceptanceCriteria.find(
      (candidate) => candidate.criterionId === assessment.criterionId,
    );
    if (criterion?.category !== "testing" || assessment.status === "unsupported") return assessment;
    return {
      ...assessment,
      supportingEvidenceIds: uniqueSorted([
        ...assessment.supportingEvidenceIds,
        ...passedTests.map((item) => item.evidenceId),
      ]),
      explanation:
        passedTests.length > 0
          ? `${assessment.explanation} An enabled test command also passed.`
          : assessment.explanation,
    };
  });
}

function sourceRecordToCore(
  raw: ResearchSourceRecord,
  knownCriterionIds: ReadonlySet<string>,
): ExternalSourceRecord {
  for (const criterionId of [...raw.claimsSupported, ...raw.claimsContradicted]) {
    if (!knownCriterionIds.has(criterionId)) {
      throw new Error(`Approved source record references an unknown criterion: ${criterionId}`);
    }
  }
  const sourceId = stableId("source", raw.normalizedUrl);
  const citedSupport = raw.citationAnnotations.length > 0 ? raw.claimsSupported : [];
  return ExternalSourceRecordSchema.parse({
    sourceId,
    webSearchCallId: raw.webSearchCallId,
    url: raw.url,
    normalizedUrl: raw.normalizedUrl,
    title: raw.title,
    domain: raw.domain,
    ...(raw.publisher === undefined ? {} : { publisher: raw.publisher }),
    ...(raw.publishedAt === undefined && raw.updatedAt === undefined
      ? {}
      : { publishedAt: raw.publishedAt ?? raw.updatedAt }),
    retrievedAt: raw.retrievedAt,
    sourceType: raw.sourceType,
    isPrimary: raw.isPrimary,
    isOfficial: raw.isOfficial,
    allowedByPolicy: raw.allowedByPolicy,
    freshnessStatus: raw.freshnessStatus,
    ...(raw.contentHash === undefined ? {} : { contentHash: raw.contentHash }),
    citationAnnotations: raw.citationAnnotations.map((citation, index) => ({
      citationId: stableId("citation", [raw.normalizedUrl, index, citation]),
      sourceId,
      ...(citation.startIndex === undefined ? {} : { startIndex: citation.startIndex }),
      ...(citation.endIndex === undefined ? {} : { endIndex: citation.endIndex }),
      ...(citation.citedText === undefined ? {} : { citedText: citation.citedText }),
    })),
    claimsSupported: uniqueSorted(citedSupport),
    claimsContradicted: uniqueSorted(raw.claimsContradicted),
    limitations: uniqueSorted(raw.limitations),
  });
}

function mergeSourceRecords(records: ExternalSourceRecord[]): ExternalSourceRecord[] {
  const byUrl = new Map<string, ExternalSourceRecord>();
  for (const source of records) {
    const existing = byUrl.get(source.normalizedUrl);
    if (existing === undefined) {
      byUrl.set(source.normalizedUrl, source);
      continue;
    }
    const citations = [...existing.citationAnnotations, ...source.citationAnnotations];
    const seenCitations = new Set<string>();
    byUrl.set(
      source.normalizedUrl,
      ExternalSourceRecordSchema.parse({
        ...existing,
        citationAnnotations: citations.filter((citation) => {
          const key = JSON.stringify([
            citation.startIndex,
            citation.endIndex,
            citation.citedText ?? "",
          ]);
          if (seenCitations.has(key)) return false;
          seenCitations.add(key);
          return true;
        }),
        claimsSupported: uniqueSorted([...existing.claimsSupported, ...source.claimsSupported]),
        claimsContradicted: uniqueSorted([
          ...existing.claimsContradicted,
          ...source.claimsContradicted,
        ]),
        limitations: uniqueSorted([...existing.limitations, ...source.limitations]),
      }),
    );
  }
  return [...byUrl.values()].sort((left, right) =>
    left.normalizedUrl.localeCompare(right.normalizedUrl),
  );
}

function effectiveSourceMode(
  taskMode: SourceMode,
  configMode: EvidenceGateConfig["sources"]["mode"],
  requestedMode?: "requested" | "required",
): SourceMode {
  if (taskMode === "off" || configMode === "off") return "off";
  const rank: Record<Exclude<SourceMode, "off">, number> = {
    requested: 1,
    automatic_for_external_claims: 2,
    required: 3,
  };
  const candidates: Exclude<SourceMode, "off">[] = [taskMode, configMode];
  if (requestedMode !== undefined) candidates.push(requestedMode);
  return candidates.sort((left, right) => rank[right] - rank[left])[0] ?? "requested";
}

interface ExternalEvidenceResult {
  sources: ExternalSourceRecord[];
  assessments: ExternalClaimAssessment[];
  researchRuns: EvidenceBundle["researchRuns"];
}

function externalEvidenceFromArtifact(
  task: TaskSpecification,
  config: EvidenceGateConfig,
  mode: SourceMode,
  artifact: ApprovedSourceResultsArtifact | undefined,
): ExternalEvidenceResult {
  const expectedPlans = buildSourcePlans(task, config);
  const planByCriterion = new Map(expectedPlans.map((plan) => [plan.criterionId, plan]));
  const knownCriteria = new Set(task.acceptanceCriteria.map((criterion) => criterion.criterionId));
  const importedSources =
    artifact?.results.flatMap((result) =>
      result.registry.sources.map((source) => sourceRecordToCore(source, knownCriteria)),
    ) ?? [];
  const sources = mergeSourceRecords(importedSources);
  const resultByCriterion = new Map<string, SourceResearchResult[]>();
  for (const result of artifact?.results ?? []) {
    for (const criterionId of result.metadata.criterionIds) {
      if (!knownCriteria.has(criterionId)) {
        throw new Error(
          `Approved research metadata references an unknown criterion: ${criterionId}`,
        );
      }
      resultByCriterion.set(criterionId, [...(resultByCriterion.get(criterionId) ?? []), result]);
    }
  }

  const assessments = task.acceptanceCriteria.map((criterion): ExternalClaimAssessment => {
    const domain = resolveEvidenceDomain(criterion);
    const plan = planByCriterion.get(criterion.criterionId);
    if (domain === "internal" || plan === undefined || mode === "off") {
      return {
        criterionId: criterion.criterionId,
        normalizedClaim: criterion.text,
        status: "not_applicable",
        supportingSourceIds: [],
        contradictingSourceIds: [],
        requiredSourceTypes: [],
        missingSourceTypes: [],
        freshnessWarning: false,
        explanation:
          mode === "off" && domain !== "internal"
            ? "External research is prohibited by the effective source mode."
            : "This criterion is not configured for external-source evidence.",
        unresolvedQuestions: [],
      };
    }

    const results = resultByCriterion.get(criterion.criterionId) ?? [];
    const acceptedSourceType = (source: ExternalSourceRecord): boolean =>
      source.sourceType !== "unknown" &&
      (plan.sourcePolicy.requiredSourceTypes.length === 0 ||
        plan.sourcePolicy.requiredSourceTypes.includes(source.sourceType));
    const currentSupporting = sources.filter(
      (source) =>
        source.allowedByPolicy &&
        (plan.maxSourceAgeDays === null || source.freshnessStatus === "current") &&
        acceptedSourceType(source) &&
        source.claimsSupported.includes(criterion.criterionId),
    );
    const reviewableSupporting = sources.filter(
      (source) =>
        source.allowedByPolicy &&
        plan.maxSourceAgeDays !== null &&
        (source.freshnessStatus === "possibly_stale" || source.freshnessStatus === "unknown") &&
        acceptedSourceType(source) &&
        source.claimsSupported.includes(criterion.criterionId),
    );
    const contradicting = sources.filter(
      (source) =>
        source.allowedByPolicy && source.claimsContradicted.includes(criterion.criterionId),
    );
    const anyFailed = results.some(
      (result) => result.metadata.status === "failed" || !result.registry.valid,
    );
    const allSupporting = [...currentSupporting, ...reviewableSupporting];
    const hasConflict = allSupporting.length > 0 && contradicting.length > 0;
    const sourceRequired =
      mode === "required" ||
      mode === "automatic_for_external_claims" ||
      criterion.externalEvidence?.mode === "required";
    let status: ExternalClaimAssessment["status"];
    if (artifact === undefined) {
      status = sourceRequired ? "source_error" : "insufficient_sources";
    } else if (results.length === 0) {
      status = sourceRequired ? "source_error" : "insufficient_sources";
    } else if (hasConflict) {
      status = "conflicting_sources";
    } else if (contradicting.length > 0) {
      status = "contradicted";
    } else {
      const preferredPublishers = criterion.externalEvidence?.preferredPublishers ?? [];
      const publisherPreferenceMet =
        preferredPublishers.length === 0 ||
        currentSupporting.some((source) =>
          preferredPublishers.some((publisher) =>
            source.publisher?.toLocaleLowerCase().includes(publisher.toLocaleLowerCase()),
          ),
        );
      if (currentSupporting.length >= plan.minimumSourceCount && publisherPreferenceMet) {
        status = "supported";
      } else if (allSupporting.length >= plan.minimumSourceCount) {
        status = "partially_supported";
      } else if (anyFailed && allSupporting.length === 0) {
        status = "source_error";
      } else if (allSupporting.length > 0) {
        status = "insufficient_sources";
      } else {
        status = "not_supported";
      }
    }
    const observedTypes = new Set(allSupporting.map((source) => source.sourceType));
    const acceptedTypes = plan.sourcePolicy.requiredSourceTypes;
    const hasAcceptedType =
      acceptedTypes.length === 0 ||
      acceptedTypes.some((sourceType) => observedTypes.has(sourceType));
    const missingSourceTypes = hasAcceptedType ? [] : [...acceptedTypes];
    const unresolvedQuestions: string[] = [];
    if (allSupporting.length < plan.minimumSourceCount) {
      unresolvedQuestions.push(
        `Need ${plan.minimumSourceCount} accepted source(s); found ${allSupporting.length}.`,
      );
    }
    const preferredPublishers = criterion.externalEvidence?.preferredPublishers ?? [];
    if (
      preferredPublishers.length > 0 &&
      !allSupporting.some((source) =>
        preferredPublishers.some((publisher) =>
          source.publisher?.toLocaleLowerCase().includes(publisher.toLocaleLowerCase()),
        ),
      )
    ) {
      unresolvedQuestions.push(
        `No accepted source matched preferred publisher(s): ${preferredPublishers.join(", ")}.`,
      );
    }
    if (results.length === 0)
      unresolvedQuestions.push("No approved research run covered this criterion.");
    return {
      criterionId: criterion.criterionId,
      normalizedClaim: criterion.text,
      status,
      supportingSourceIds: allSupporting.map((source) => source.sourceId),
      contradictingSourceIds: contradicting.map((source) => source.sourceId),
      requiredSourceTypes: [...acceptedTypes],
      missingSourceTypes,
      freshnessWarning: sources.some(
        (source) =>
          plan.maxSourceAgeDays !== null &&
          (source.claimsSupported.includes(criterion.criterionId) ||
            source.claimsContradicted.includes(criterion.criterionId)) &&
          source.freshnessStatus !== "current",
      ),
      explanation:
        status === "supported"
          ? plan.maxSourceAgeDays === null
            ? `${currentSupporting.length} freshness-eligible approved source(s) satisfy the configured policy; no maximum source age is configured.`
            : `${currentSupporting.length} current approved source(s) satisfy the configured policy.`
          : status === "partially_supported"
            ? "Cited source evidence is relevant but freshness or publisher preference requires manual review."
            : status === "source_error"
              ? "Required approved source research is missing or failed validation."
              : status === "contradicted"
                ? "Approved source evidence contradicts this criterion."
                : status === "conflicting_sources"
                  ? "Approved source records both support and contradict this criterion."
                  : "Approved source evidence does not yet satisfy the configured policy.",
      unresolvedQuestions,
    };
  });

  const researchRuns: EvidenceBundle["researchRuns"] = [];
  if (artifact !== undefined && artifact.results.length > 0) {
    const metadata = artifact.results.map((result) => result.metadata);
    const webSearchCallIds = uniqueSorted([
      ...metadata.flatMap((run) => run.webSearchCallIds),
      ...sources.map((source) => source.webSearchCallId),
    ]);
    const allValid = artifact.results.every(
      (result) => result.registry.valid && result.metadata.status === "completed",
    );
    researchRuns.push(
      ResearchRunMetadataSchema.parse({
        researchRunId: stableId("research", artifact.planHash),
        criterionIds: uniqueSorted(metadata.flatMap((run) => run.criterionIds)),
        model: metadata[0]?.model ?? config.analysis.model,
        webSearchCallIds,
        queries: metadata.flatMap((run) => run.queries),
        allowedDomains: uniqueSorted(metadata.flatMap((run) => run.allowedDomains)),
        blockedDomains: uniqueSorted(metadata.flatMap((run) => run.blockedDomains)),
        startedAt: metadata.map((run) => run.startedAt).sort()[0] ?? artifact.approvedAt,
        completedAt:
          metadata
            .map((run) => run.completedAt)
            .sort()
            .at(-1) ?? artifact.approvedAt,
        sourceCount: sources.length,
        citationCount: sources.reduce(
          (count, source) => count + source.citationAnnotations.length,
          0,
        ),
        status: allValid ? "completed" : sources.length > 0 ? "partial" : "failed",
      }),
    );
  }
  return { sources, assessments, researchRuns };
}

function severityForCriterion(
  criterion: AcceptanceCriterion,
  task: TaskSpecification,
): CombinedClaimAssessment["severityIfMissing"] {
  if (criterion.category === "security" || criterion.category === "authorization")
    return "critical";
  if (task.riskLevel === "critical") return "critical";
  if (task.riskLevel === "high") return "high";
  if (task.riskLevel === "medium") return "medium";
  return criterion.required ? "high" : "low";
}

function combineAssessments(
  task: TaskSpecification,
  internal: InternalClaimAssessment[],
  external: ExternalClaimAssessment[],
  gatePolicy: GatePolicy,
): CombinedClaimAssessment[] {
  const internalByCriterion = new Map(internal.map((item) => [item.criterionId, item]));
  const externalByCriterion = new Map(external.map((item) => [item.criterionId, item]));
  return task.acceptanceCriteria.map((criterion) => {
    const internalAssessment = internalByCriterion.get(criterion.criterionId);
    const externalAssessment = externalByCriterion.get(criterion.criterionId);
    if (internalAssessment === undefined || externalAssessment === undefined) {
      throw new Error(`Missing assessment for criterion ${criterion.criterionId}.`);
    }
    const base: CombinedClaimAssessment = {
      criterionId: criterion.criterionId,
      normalizedClaim: criterion.text,
      evidenceDomain: resolveEvidenceDomain(criterion),
      internalStatus: internalAssessment.status,
      externalStatus: externalAssessment.status,
      combinedStatus: "analysis_error",
      internalEvidenceIds: internalAssessment.supportingEvidenceIds,
      externalSourceIds: uniqueSorted([
        ...externalAssessment.supportingSourceIds,
        ...externalAssessment.contradictingSourceIds,
      ]),
      contradictingEvidenceIds: internalAssessment.contradictingEvidenceIds,
      missingEvidence: uniqueSorted([
        ...internalAssessment.missingEvidence,
        ...externalAssessment.unresolvedQuestions,
      ]),
      explanation: `${internalAssessment.explanation} ${externalAssessment.explanation}`,
      severityIfMissing: severityForCriterion(criterion, task),
    };
    return { ...base, combinedStatus: deriveCombinedStatus(base, gatePolicy) };
  });
}

export interface WorkflowDependencies {
  collectSnapshot?: (
    repositoryPath: string,
    options: { baseRef: string; headRef?: string; maxDiffBytes?: number },
  ) => GitRepositorySnapshot;
  executeCommands?: (specs: CommandSpec[]) => Promise<CommandResult[]>;
}

export interface RunWorkflowOptions {
  cwd: string;
  task: TaskSpecification;
  config: EvidenceGateConfig;
  approvedSources?: ApprovedSourceResultsArtifact;
  sourceIntent?: "requested" | "required";
  generatedAt?: Date;
  dependencies?: WorkflowDependencies;
}

export interface WorkflowResult {
  bundle: EvidenceBundle;
  filesScanned: number;
  sourceMode: SourceMode;
}

export async function runEvidenceGateWorkflow(
  options: RunWorkflowOptions,
): Promise<WorkflowResult> {
  const generatedAt = options.generatedAt ?? new Date();
  const timestamp = generatedAt.toISOString();
  const repositoryPath = path.resolve(options.cwd, options.task.repositoryPath);
  const collectSnapshot = options.dependencies?.collectSnapshot ?? collectRepositorySnapshot;
  const gitSnapshot = collectSnapshot(repositoryPath, {
    baseRef: options.task.baseRef,
    headRef: options.task.headRef,
    maxDiffBytes: options.config.analysis.maxDiffBytes,
  });
  const inScopeChangedFiles = gitSnapshot.changedFiles
    .filter((file) => isPathInScope(file.path, options.task, options.config))
    .slice(0, options.config.analysis.maxChangedFiles);
  const changedPaths = inScopeChangedFiles
    .filter((file) => file.status !== "deleted")
    .map((file) => file.path);
  const hintAnalysis = analyzeRepositoryWithHints(
    gitSnapshot.repositoryRoot,
    options.task.acceptanceCriteria,
    changedPaths,
    timestamp,
  );

  const commandEntries = Object.entries(options.config.commands)
    .filter(([, command]) => command.enabled)
    .sort(([left], [right]) => left.localeCompare(right));
  const commandSpecs: CommandSpec[] = commandEntries.map(([id, command]) => ({
    id,
    command: command.command,
    cwd: gitSnapshot.repositoryRoot,
    required: command.required,
    timeoutSeconds: command.timeoutSeconds,
    maxOutputBytes: Math.min(options.config.analysis.maxDiffBytes, 200_000),
  }));
  const executeCommands = options.dependencies?.executeCommands ?? runCommands;
  const commandResults = await executeCommands(commandSpecs);
  const requiredById = new Map(commandSpecs.map((spec) => [spec.id, spec.required]));
  const allCriterionIds = options.task.acceptanceCriteria.map((criterion) => criterion.criterionId);
  const commandEvidence = commandResults.map((result) =>
    commandResultToEvidence(result, allCriterionIds, requiredById.get(result.commandId) ?? false),
  );
  const internalAssessments = mergeInternalCommandEvidence(
    options.task,
    hintAnalysis.assessments,
    commandEvidence,
  );
  const diffHash = hashText(gitSnapshot.diff);
  const gitEvidence: EvidenceItem = {
    evidenceId: stableId("git", [gitSnapshot.baseRef, gitSnapshot.headSha, diffHash]),
    criterionIds: allCriterionIds,
    kind: "git_diff",
    status: gitSnapshot.diffTruncated ? "warning" : "informational",
    summary: `Captured ${inScopeChangedFiles.length} in-scope changed file(s) from ${gitSnapshot.baseRef} to ${gitSnapshot.headRef}.`,
    capturedAt: gitSnapshot.capturedAt,
    contentHash: diffHash,
    metadata: {
      changedFilesBeforeScope: gitSnapshot.changedFiles.length,
      changedFilesInScope: inScopeChangedFiles.length,
      diffBytes: gitSnapshot.diffBytes,
      diffTruncated: gitSnapshot.diffTruncated,
    },
  };
  const internalEvidence = [gitEvidence, ...hintAnalysis.evidence, ...commandEvidence];

  const sourceMode = effectiveSourceMode(
    options.task.sourceMode,
    options.config.sources.mode,
    options.sourceIntent,
  );
  if (sourceMode === "off" && options.approvedSources !== undefined) {
    throw new Error(
      "The effective source mode is off; approved source results cannot be consumed.",
    );
  }
  const approvedSources =
    options.approvedSources === undefined
      ? undefined
      : parseApprovedSourceResultsArtifact(options.approvedSources, options.task, options.config);
  const external = externalEvidenceFromArtifact(
    options.task,
    options.config,
    sourceMode,
    approvedSources,
  );
  const gatePolicy = resolveGatePolicy(options.config.gate);
  const combined = combineAssessments(
    options.task,
    internalAssessments,
    external.assessments,
    gatePolicy,
  );
  const gate = evaluateGate(
    {
      task: options.task,
      combinedClaimAssessments: combined,
      internalEvidence,
      findings: [],
    },
    gatePolicy,
  );
  const bundle = createEvidenceBundle({
    schemaVersion: 1,
    bundleId: stableId("bundle", [options.task.taskId, gitSnapshot.headSha, timestamp]),
    generatedAt: timestamp,
    toolVersion: "0.1.0",
    task: options.task,
    repository: {
      repositoryPath: options.task.repositoryPath,
      baseRef: options.task.baseRef,
      headRef: options.task.headRef,
      headCommit: gitSnapshot.headSha,
      capturedAt: gitSnapshot.capturedAt,
      isDirty: gitSnapshot.isDirty,
      changedFiles: inScopeChangedFiles.map((file) => ({
        path: file.path,
        status: file.status === "unknown" ? "modified" : file.status,
        ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
        additions: 0,
        deletions: 0,
        binary: false,
      })),
      diffHash,
    },
    internalEvidence,
    externalSources: external.sources,
    internalClaimAssessments: internalAssessments,
    externalClaimAssessments: external.assessments,
    combinedClaimAssessments: combined,
    findings: [],
    gate,
    researchRuns: external.researchRuns,
    modelRuns: [],
    sourcePolicyVersion: "source-policy-v1",
    gatePolicyVersion: CURRENT_GATE_POLICY_VERSION,
    gatePolicy,
  });
  return { bundle, filesScanned: hintAnalysis.filesScanned, sourceMode };
}

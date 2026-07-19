import { z } from "zod";

const IdentifierSchema = z.string().min(1).max(256).regex(/^\S+$/u, "ID cannot contain whitespace");
const BoundedTextSchema = z
  .string()
  .min(1)
  .max(20_000)
  .refine((value) => value.trim().length > 0, "Text cannot be blank");
const ShortTextSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine((value) => value.trim().length > 0, "Text cannot be blank");
const CitationExcerptSchema = z
  .string()
  .min(1)
  .max(4_000)
  .refine((value) => value.trim().length > 0, "Citation excerpt cannot be blank");

function uniqueStringsSchema(item: z.ZodType<string>, maximum = 1_000) {
  return z
    .array(item)
    .max(maximum)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate value: ${value}`,
            path: [index],
          });
        }
        seen.add(value);
      });
    });
}

function uniqueIdentifiersSchema(maximum = 1_000) {
  return uniqueStringsSchema(IdentifierSchema, maximum);
}

function uniqueTextSchema(maximum = 1_000) {
  return uniqueStringsSchema(ShortTextSchema, maximum);
}

export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export const EvidenceDomainSchema = z.enum(["internal", "external", "hybrid"]);
export const SourceTypeSchema = z.enum([
  "official_documentation",
  "standard",
  "government",
  "maintainer_release",
  "package_registry",
  "peer_reviewed",
  "official_repository",
  "reputable_secondary",
  "community",
  "unknown",
]);
export const FreshnessStatusSchema = z.enum(["current", "possibly_stale", "stale", "unknown"]);
export const EvidenceStatusSchema = z.enum([
  "passed",
  "failed",
  "warning",
  "informational",
  "unavailable",
  "not_run",
]);

export const AdjudicationCriterionSchema = z
  .object({
    criterionId: IdentifierSchema,
    normalizedClaim: BoundedTextSchema,
    internalClaim: BoundedTextSchema.optional(),
    externalClaim: BoundedTextSchema.optional(),
    evidenceDomain: EvidenceDomainSchema,
    severityIfMissing: SeveritySchema.default("medium"),
    requiredSourceTypes: z.array(SourceTypeSchema).default([]),
  })
  .strict();

export const InternalEvidenceSummarySchema = z
  .object({
    evidenceId: IdentifierSchema,
    criterionIds: uniqueIdentifiersSchema(500),
    status: EvidenceStatusSchema,
    summary: ShortTextSchema,
    details: z.string().max(20_000).optional(),
  })
  .passthrough();

export const ExternalSourceSummarySchema = z
  .object({
    sourceId: IdentifierSchema,
    url: z
      .string()
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            (url.protocol === "https:" || url.protocol === "http:") &&
            url.username === "" &&
            url.password === ""
          );
        } catch {
          return false;
        }
      }, "Only HTTP/HTTPS source URLs without credentials are allowed"),
    title: ShortTextSchema,
    domain: z.string().trim().min(1).max(253),
    sourceType: SourceTypeSchema,
    isPrimary: z.boolean(),
    isOfficial: z.boolean(),
    allowedByPolicy: z.boolean(),
    freshnessStatus: FreshnessStatusSchema,
    claimsSupported: uniqueTextSchema(500),
    claimsContradicted: uniqueTextSchema(500),
    limitations: uniqueTextSchema(500),
    citationExcerpts: z.array(CitationExcerptSchema).max(100).optional(),
    criterionIds: uniqueIdentifiersSchema(500),
  })
  .passthrough();

export const AdjudicationInputSchema = z
  .object({
    criteria: z.array(AdjudicationCriterionSchema).min(1).max(500),
    internalEvidence: z.array(InternalEvidenceSummarySchema).max(5_000),
    externalSources: z.array(ExternalSourceSummarySchema).max(1_000),
    researchNarrative: z.string().max(20_000).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const checkUniqueIds = (values: readonly string[], path: string, label: string): void => {
      const seen = new Set<string>();
      values.forEach((value, index) => {
        if (seen.has(value)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate ${label}: ${value}`,
            path: [path, index],
          });
        }
        seen.add(value);
      });
    };

    checkUniqueIds(
      input.criteria.map((criterion) => criterion.criterionId),
      "criteria",
      "criterion ID",
    );
    checkUniqueIds(
      input.internalEvidence.map((evidence) => evidence.evidenceId),
      "internalEvidence",
      "evidence ID",
    );
    checkUniqueIds(
      input.externalSources.map((source) => source.sourceId),
      "externalSources",
      "source ID",
    );

    const criterionIds = new Set(input.criteria.map((criterion) => criterion.criterionId));
    input.internalEvidence.forEach((evidence, evidenceIndex) => {
      evidence.criterionIds.forEach((criterionId, criterionIndex) => {
        if (!criterionIds.has(criterionId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Evidence references unknown criterion ID: ${criterionId}`,
            path: ["internalEvidence", evidenceIndex, "criterionIds", criterionIndex],
          });
        }
      });
    });
    input.externalSources.forEach((source, sourceIndex) => {
      source.criterionIds.forEach((criterionId, criterionIndex) => {
        if (!criterionIds.has(criterionId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Source references unknown criterion ID: ${criterionId}`,
            path: ["externalSources", sourceIndex, "criterionIds", criterionIndex],
          });
        }
      });
    });
  });

export const InternalStatusSchema = z.enum([
  "verified",
  "partially_verified",
  "unsupported",
  "contradicted",
  "not_applicable",
  "analysis_error",
]);
export const ExternalStatusSchema = z.enum([
  "supported",
  "partially_supported",
  "not_supported",
  "contradicted",
  "conflicting_sources",
  "insufficient_sources",
  "not_applicable",
  "source_error",
]);
export const CombinedStatusSchema = z.enum([
  "verified",
  "partially_verified",
  "unsupported",
  "contradicted",
  "manual_review",
  "analysis_error",
]);

export const InternalClaimAssessmentSchema = z
  .object({
    criterionId: IdentifierSchema,
    normalizedClaim: BoundedTextSchema,
    status: InternalStatusSchema,
    supportingEvidenceIds: uniqueIdentifiersSchema(),
    contradictingEvidenceIds: uniqueIdentifiersSchema(),
    missingEvidence: uniqueTextSchema(),
    explanation: BoundedTextSchema,
  })
  .strict();

export const ExternalClaimAssessmentSchema = z
  .object({
    criterionId: IdentifierSchema,
    normalizedClaim: BoundedTextSchema,
    status: ExternalStatusSchema,
    supportingSourceIds: uniqueIdentifiersSchema(),
    contradictingSourceIds: uniqueIdentifiersSchema(),
    requiredSourceTypes: z.array(SourceTypeSchema),
    missingSourceTypes: z.array(SourceTypeSchema),
    freshnessWarning: z.boolean(),
    explanation: BoundedTextSchema,
    unresolvedQuestions: uniqueTextSchema(),
  })
  .strict();

export const CombinedClaimAssessmentSchema = z
  .object({
    criterionId: IdentifierSchema,
    normalizedClaim: BoundedTextSchema,
    evidenceDomain: EvidenceDomainSchema,
    internalStatus: InternalStatusSchema,
    externalStatus: ExternalStatusSchema,
    combinedStatus: CombinedStatusSchema,
    internalEvidenceIds: uniqueIdentifiersSchema(),
    externalSourceIds: uniqueIdentifiersSchema(),
    contradictingEvidenceIds: uniqueIdentifiersSchema(),
    missingEvidence: uniqueTextSchema(),
    explanation: BoundedTextSchema,
    severityIfMissing: SeveritySchema,
  })
  .strict();

function uniqueAssessmentCriteria(
  values: readonly { criterionId: string }[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.criterionId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate assessment criterion ID: ${value.criterionId}`,
        path: [index, "criterionId"],
      });
    }
    seen.add(value.criterionId);
  });
}

export const AdjudicationOutputSchema = z
  .object({
    internalClaimAssessments: z
      .array(InternalClaimAssessmentSchema)
      .superRefine(uniqueAssessmentCriteria),
    externalClaimAssessments: z
      .array(ExternalClaimAssessmentSchema)
      .superRefine(uniqueAssessmentCriteria),
    combinedClaimAssessments: z
      .array(CombinedClaimAssessmentSchema)
      .superRefine(uniqueAssessmentCriteria),
  })
  .strict();

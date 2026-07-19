import { z } from "zod";

import {
  IdentifierSchema,
  NonEmptyTextSchema,
  SeveritySchema,
  uniqueStringsSchema,
} from "./common.js";
import { SourceTypeSchema } from "./source.js";

export const ResolvedEvidenceDomainSchema = z.enum(["internal", "external", "hybrid"]);
export type ResolvedEvidenceDomain = z.infer<typeof ResolvedEvidenceDomainSchema>;

export const InternalStatusSchema = z.enum([
  "verified",
  "partially_verified",
  "unsupported",
  "contradicted",
  "not_applicable",
  "analysis_error",
]);
export type InternalStatus = z.infer<typeof InternalStatusSchema>;

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
export type ExternalStatus = z.infer<typeof ExternalStatusSchema>;

export const CombinedStatusSchema = z.enum([
  "verified",
  "partially_verified",
  "unsupported",
  "contradicted",
  "manual_review",
  "analysis_error",
]);
export type CombinedStatus = z.infer<typeof CombinedStatusSchema>;

export const InternalClaimAssessmentSchema = z
  .object({
    criterionId: IdentifierSchema,
    normalizedClaim: NonEmptyTextSchema,
    status: InternalStatusSchema,
    supportingEvidenceIds: uniqueStringsSchema(),
    contradictingEvidenceIds: uniqueStringsSchema(),
    missingEvidence: uniqueStringsSchema(),
    explanation: NonEmptyTextSchema,
  })
  .strict();
export type InternalClaimAssessment = z.infer<typeof InternalClaimAssessmentSchema>;

export const ExternalClaimAssessmentSchema = z
  .object({
    criterionId: IdentifierSchema,
    normalizedClaim: NonEmptyTextSchema,
    status: ExternalStatusSchema,
    supportingSourceIds: uniqueStringsSchema(),
    contradictingSourceIds: uniqueStringsSchema(),
    requiredSourceTypes: z.array(SourceTypeSchema),
    missingSourceTypes: z.array(SourceTypeSchema),
    freshnessWarning: z.boolean(),
    explanation: NonEmptyTextSchema,
    unresolvedQuestions: uniqueStringsSchema(),
  })
  .strict();
export type ExternalClaimAssessment = z.infer<typeof ExternalClaimAssessmentSchema>;

export const CombinedClaimAssessmentSchema = z
  .object({
    criterionId: IdentifierSchema,
    normalizedClaim: NonEmptyTextSchema,
    evidenceDomain: ResolvedEvidenceDomainSchema,
    internalStatus: InternalStatusSchema,
    externalStatus: ExternalStatusSchema,
    combinedStatus: CombinedStatusSchema,
    internalEvidenceIds: uniqueStringsSchema(),
    externalSourceIds: uniqueStringsSchema(),
    contradictingEvidenceIds: uniqueStringsSchema(),
    missingEvidence: uniqueStringsSchema(),
    explanation: NonEmptyTextSchema,
    severityIfMissing: SeveritySchema,
  })
  .strict();
export type CombinedClaimAssessment = z.infer<typeof CombinedClaimAssessmentSchema>;

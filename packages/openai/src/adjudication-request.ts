import {
  ADJUDICATION_SYSTEM_INSTRUCTIONS,
  buildAdjudicationInputText,
  type AdjudicationValidationFeedback,
} from "./adjudication-prompt.js";
import type { AdjudicationInput } from "./types.js";

export const DEFAULT_ADJUDICATION_MODEL = "gpt-5.6-terra";

const SOURCE_TYPES = [
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
] as const;
const INTERNAL_STATUSES = [
  "verified",
  "partially_verified",
  "unsupported",
  "contradicted",
  "not_applicable",
  "analysis_error",
] as const;
const EXTERNAL_STATUSES = [
  "supported",
  "partially_supported",
  "not_supported",
  "contradicted",
  "conflicting_sources",
  "insufficient_sources",
  "not_applicable",
  "source_error",
] as const;
const COMBINED_STATUSES = [
  "verified",
  "partially_verified",
  "unsupported",
  "contradicted",
  "manual_review",
  "analysis_error",
] as const;

const stringArray = {
  type: "array",
  items: { type: "string" },
} as const;

const internalAssessmentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "criterionId",
    "normalizedClaim",
    "status",
    "supportingEvidenceIds",
    "contradictingEvidenceIds",
    "missingEvidence",
    "explanation",
  ],
  properties: {
    criterionId: { type: "string" },
    normalizedClaim: { type: "string" },
    status: { type: "string", enum: INTERNAL_STATUSES },
    supportingEvidenceIds: stringArray,
    contradictingEvidenceIds: stringArray,
    missingEvidence: stringArray,
    explanation: { type: "string" },
  },
} as const;

const externalAssessmentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "criterionId",
    "normalizedClaim",
    "status",
    "supportingSourceIds",
    "contradictingSourceIds",
    "requiredSourceTypes",
    "missingSourceTypes",
    "freshnessWarning",
    "explanation",
    "unresolvedQuestions",
  ],
  properties: {
    criterionId: { type: "string" },
    normalizedClaim: { type: "string" },
    status: { type: "string", enum: EXTERNAL_STATUSES },
    supportingSourceIds: stringArray,
    contradictingSourceIds: stringArray,
    requiredSourceTypes: {
      type: "array",
      items: { type: "string", enum: SOURCE_TYPES },
    },
    missingSourceTypes: {
      type: "array",
      items: { type: "string", enum: SOURCE_TYPES },
    },
    freshnessWarning: { type: "boolean" },
    explanation: { type: "string" },
    unresolvedQuestions: stringArray,
  },
} as const;

const combinedAssessmentSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "criterionId",
    "normalizedClaim",
    "evidenceDomain",
    "internalStatus",
    "externalStatus",
    "combinedStatus",
    "internalEvidenceIds",
    "externalSourceIds",
    "contradictingEvidenceIds",
    "missingEvidence",
    "explanation",
    "severityIfMissing",
  ],
  properties: {
    criterionId: { type: "string" },
    normalizedClaim: { type: "string" },
    evidenceDomain: { type: "string", enum: ["internal", "external", "hybrid"] },
    internalStatus: { type: "string", enum: INTERNAL_STATUSES },
    externalStatus: { type: "string", enum: EXTERNAL_STATUSES },
    combinedStatus: { type: "string", enum: COMBINED_STATUSES },
    internalEvidenceIds: stringArray,
    externalSourceIds: stringArray,
    contradictingEvidenceIds: stringArray,
    missingEvidence: stringArray,
    explanation: { type: "string" },
    severityIfMissing: {
      type: "string",
      enum: ["info", "low", "medium", "high", "critical"],
    },
  },
} as const;

export const ADJUDICATION_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["internalClaimAssessments", "externalClaimAssessments", "combinedClaimAssessments"],
  properties: {
    internalClaimAssessments: {
      type: "array",
      items: internalAssessmentSchema,
    },
    externalClaimAssessments: {
      type: "array",
      items: externalAssessmentSchema,
    },
    combinedClaimAssessments: {
      type: "array",
      items: combinedAssessmentSchema,
    },
  },
} as const;

export interface OpenAIAdjudicationRequest {
  model: string;
  instructions: string;
  input: string;
  text: {
    format: {
      type: "json_schema";
      name: "evidencegate_adjudication";
      strict: true;
      schema: typeof ADJUDICATION_OUTPUT_JSON_SCHEMA;
    };
  };
}

export function buildAdjudicationRequest(
  input: AdjudicationInput,
  model = DEFAULT_ADJUDICATION_MODEL,
  validationFeedback: readonly AdjudicationValidationFeedback[] = [],
): OpenAIAdjudicationRequest {
  return {
    model,
    instructions:
      validationFeedback.length === 0
        ? ADJUDICATION_SYSTEM_INSTRUCTIONS
        : `${ADJUDICATION_SYSTEM_INSTRUCTIONS}\nThis is the single permitted correction attempt after local validation rejected the previous structured response.`,
    input: buildAdjudicationInputText(input, validationFeedback),
    text: {
      format: {
        type: "json_schema",
        name: "evidencegate_adjudication",
        strict: true,
        schema: ADJUDICATION_OUTPUT_JSON_SCHEMA,
      },
    },
  };
}

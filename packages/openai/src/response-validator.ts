import type { z } from "zod";
import { deriveCombinedStatus } from "@evidencegate/core";

import { createAdjudicationPromptPayload } from "./adjudication-prompt.js";
import { AdjudicationInputSchema, AdjudicationOutputSchema } from "./schemas.js";
import type {
  AdjudicationInput,
  AdjudicationOutput,
  CombinedClaimAssessment,
  ExternalClaimAssessment,
  InternalClaimAssessment,
  NormalizedAdjudicationInput,
} from "./types.js";

export interface AdjudicationValidationIssue {
  path: string;
  message: string;
}

export type AdjudicationValidationFailureKind =
  | "invalid_input"
  | "response_envelope"
  | "incomplete"
  | "refusal"
  | "invalid_json"
  | "schema_violation"
  | "binding_violation";

export class AdjudicationValidationError extends Error {
  public readonly issues: readonly AdjudicationValidationIssue[];
  public readonly kind: AdjudicationValidationFailureKind;

  public constructor(
    issues: readonly AdjudicationValidationIssue[],
    kind: AdjudicationValidationFailureKind = "binding_violation",
  ) {
    super(`Evidence adjudication failed validation with ${issues.length} issue(s).`);
    this.name = "AdjudicationValidationError";
    this.issues = issues;
    this.kind = kind;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectAdjudicationOutput(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value["internalClaimAssessments"]) &&
    Array.isArray(value["externalClaimAssessments"]) &&
    Array.isArray(value["combinedClaimAssessments"])
  );
}

function extractStructuredText(response: unknown): string {
  if (typeof response === "string") return response;
  if (!isRecord(response)) {
    throw new AdjudicationValidationError(
      [{ path: "response", message: "Response is not an object or JSON string." }],
      "response_envelope",
    );
  }

  if (response["status"] === "incomplete") {
    throw new AdjudicationValidationError(
      [{ path: "response.status", message: "Model response is incomplete." }],
      "incomplete",
    );
  }

  const output = response["output"];
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!isRecord(item)) continue;
      const content = item["content"];
      if (!Array.isArray(content)) continue;
      if (content.some((part) => isRecord(part) && part["type"] === "refusal")) {
        throw new AdjudicationValidationError(
          [{ path: "response.output", message: "Model refused evidence adjudication." }],
          "refusal",
        );
      }
    }
  }

  const shortcut = response["output_text"];
  if (typeof shortcut === "string" && shortcut.trim() !== "") return shortcut;

  if (!Array.isArray(output)) {
    throw new AdjudicationValidationError(
      [{ path: "response.output", message: "Response has no structured output text." }],
      "response_envelope",
    );
  }

  const textParts: string[] = [];
  for (const item of output) {
    if (!isRecord(item) || item["type"] !== "message") continue;
    const content = item["content"];
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecord(part)) continue;
      if (part["type"] === "refusal") {
        throw new AdjudicationValidationError(
          [{ path: "response.output", message: "Model refused evidence adjudication." }],
          "refusal",
        );
      }
      if (part["type"] === "output_text" && typeof part["text"] === "string") {
        textParts.push(part["text"]);
      }
    }
  }

  if (textParts.length === 0) {
    throw new AdjudicationValidationError(
      [{ path: "response.output", message: "Response contains no output_text content." }],
      "response_envelope",
    );
  }
  return textParts.join("");
}

function parseCandidate(response: unknown): unknown {
  if (isDirectAdjudicationOutput(response)) return response;
  const text = extractStructuredText(response);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AdjudicationValidationError(
      [{ path: "response.output_text", message: "Structured output is not valid JSON." }],
      "invalid_json",
    );
  }
}

function issuesFromZod(error: z.ZodError): AdjudicationValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length === 0 ? "response" : issue.path.join("."),
    message: issue.message,
  }));
}

function normalizeInput(input: AdjudicationInput): NormalizedAdjudicationInput {
  const parsed = AdjudicationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AdjudicationValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.length === 0 ? "input" : `input.${issue.path.join(".")}`,
        message: issue.message,
      })),
      "invalid_input",
    );
  }
  return parsed.data;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value)) &&
    right.every((value) => left.includes(value))
  );
}

function expectedCombinedStatus(
  assessment: CombinedClaimAssessment,
): CombinedClaimAssessment["combinedStatus"] {
  return deriveCombinedStatus(assessment);
}

function addIssue(issues: AdjudicationValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateCriterionCoverage(
  label: string,
  assessments: readonly { criterionId: string }[],
  criterionIds: ReadonlySet<string>,
  issues: AdjudicationValidationIssue[],
): void {
  const returnedIds = new Set(assessments.map((assessment) => assessment.criterionId));
  for (const assessment of assessments) {
    if (!criterionIds.has(assessment.criterionId)) {
      addIssue(
        issues,
        `${label}.${assessment.criterionId}`,
        `Invented criterion ID: ${assessment.criterionId}`,
      );
    }
  }
  for (const criterionId of criterionIds) {
    if (!returnedIds.has(criterionId)) {
      addIssue(issues, label, `Missing assessment for criterion ID: ${criterionId}`);
    }
  }
}

function validateReferences(
  label: string,
  ids: readonly string[],
  available: ReadonlySet<string>,
  issues: AdjudicationValidationIssue[],
): void {
  for (const id of ids) {
    if (!available.has(id)) {
      addIssue(issues, label, `Invented or unavailable ID: ${id}`);
    }
  }
}

function validateBindings(
  output: AdjudicationOutput,
  input: NormalizedAdjudicationInput,
): AdjudicationValidationIssue[] {
  const issues: AdjudicationValidationIssue[] = [];
  const criteria = new Map(input.criteria.map((criterion) => [criterion.criterionId, criterion]));
  const criterionIds = new Set(criteria.keys());
  const evidence = new Map(input.internalEvidence.map((item) => [item.evidenceId, item]));
  const sources = new Map(input.externalSources.map((source) => [source.sourceId, source]));
  const transmittedClaims = new Map(
    createAdjudicationPromptPayload(input).criteria.map((criterion) => [
      criterion.criterionId,
      criterion.normalizedClaim,
    ]),
  );
  const evidenceIds = new Set(evidence.keys());
  const sourceIds = new Set(sources.keys());

  validateCriterionCoverage(
    "internalClaimAssessments",
    output.internalClaimAssessments,
    criterionIds,
    issues,
  );
  validateCriterionCoverage(
    "externalClaimAssessments",
    output.externalClaimAssessments,
    criterionIds,
    issues,
  );
  validateCriterionCoverage(
    "combinedClaimAssessments",
    output.combinedClaimAssessments,
    criterionIds,
    issues,
  );

  const internalByCriterion = new Map(
    output.internalClaimAssessments.map((assessment) => [assessment.criterionId, assessment]),
  );
  const externalByCriterion = new Map(
    output.externalClaimAssessments.map((assessment) => [assessment.criterionId, assessment]),
  );

  const validateClaimIdentity = (
    label: string,
    assessment: InternalClaimAssessment | ExternalClaimAssessment | CombinedClaimAssessment,
  ): void => {
    const criterion = criteria.get(assessment.criterionId);
    const transmittedClaim = transmittedClaims.get(assessment.criterionId);
    if (
      criterion !== undefined &&
      transmittedClaim !== undefined &&
      assessment.normalizedClaim !== transmittedClaim
    ) {
      addIssue(
        issues,
        `${label}.${assessment.criterionId}.normalizedClaim`,
        "Assessment normalizedClaim must exactly match the supplied criterion.",
      );
    }
  };

  for (const assessment of output.internalClaimAssessments) {
    validateClaimIdentity("internalClaimAssessments", assessment);
    validateReferences(
      `internalClaimAssessments.${assessment.criterionId}.supportingEvidenceIds`,
      assessment.supportingEvidenceIds,
      evidenceIds,
      issues,
    );
    validateReferences(
      `internalClaimAssessments.${assessment.criterionId}.contradictingEvidenceIds`,
      assessment.contradictingEvidenceIds,
      evidenceIds,
      issues,
    );
    for (const id of [
      ...assessment.supportingEvidenceIds,
      ...assessment.contradictingEvidenceIds,
    ]) {
      const item = evidence.get(id);
      if (item !== undefined && !item.criterionIds.includes(assessment.criterionId)) {
        addIssue(
          issues,
          `internalClaimAssessments.${assessment.criterionId}`,
          `Evidence ID ${id} is not associated with this criterion.`,
        );
      }
    }
  }

  for (const assessment of output.externalClaimAssessments) {
    validateClaimIdentity("externalClaimAssessments", assessment);
    validateReferences(
      `externalClaimAssessments.${assessment.criterionId}.supportingSourceIds`,
      assessment.supportingSourceIds,
      sourceIds,
      issues,
    );
    validateReferences(
      `externalClaimAssessments.${assessment.criterionId}.contradictingSourceIds`,
      assessment.contradictingSourceIds,
      sourceIds,
      issues,
    );
    for (const id of [...assessment.supportingSourceIds, ...assessment.contradictingSourceIds]) {
      const source = sources.get(id);
      if (source === undefined) continue;
      if (!source.allowedByPolicy) {
        addIssue(
          issues,
          `externalClaimAssessments.${assessment.criterionId}`,
          `Source ID ${id} is not allowed by source policy.`,
        );
      }
      if (!source.criterionIds.includes(assessment.criterionId)) {
        addIssue(
          issues,
          `externalClaimAssessments.${assessment.criterionId}`,
          `Source ID ${id} is not associated with this criterion.`,
        );
      }
      const criterion = criteria.get(assessment.criterionId);
      if (
        criterion !== undefined &&
        assessment.supportingSourceIds.includes(id) &&
        criterion.requiredSourceTypes.length > 0 &&
        !criterion.requiredSourceTypes.includes(source.sourceType)
      ) {
        addIssue(
          issues,
          `externalClaimAssessments.${assessment.criterionId}`,
          `Source ID ${id} does not satisfy a required source type.`,
        );
      }
    }
    const criterion = criteria.get(assessment.criterionId);
    if (
      criterion !== undefined &&
      !sameStringSet(assessment.requiredSourceTypes, criterion.requiredSourceTypes)
    ) {
      addIssue(
        issues,
        `externalClaimAssessments.${assessment.criterionId}.requiredSourceTypes`,
        "requiredSourceTypes must exactly match the supplied criterion.",
      );
    }
    if (
      !assessment.missingSourceTypes.every((type) => assessment.requiredSourceTypes.includes(type))
    ) {
      addIssue(
        issues,
        `externalClaimAssessments.${assessment.criterionId}.missingSourceTypes`,
        "missingSourceTypes must be a subset of requiredSourceTypes.",
      );
    }
    const supportingSourceRecords = assessment.supportingSourceIds.flatMap((id) => {
      const source = sources.get(id);
      const associated = source?.criterionIds.includes(assessment.criterionId) === true;
      const sourceTypeAllowed =
        criterion === undefined ||
        criterion.requiredSourceTypes.length === 0 ||
        (source !== undefined && criterion.requiredSourceTypes.includes(source.sourceType));
      return source !== undefined && source.allowedByPolicy && associated && sourceTypeAllowed
        ? [source]
        : [];
    });
    const referencesNonCurrentSource = supportingSourceRecords.some(
      (source) => source.freshnessStatus !== "current",
    );
    if (referencesNonCurrentSource && !assessment.freshnessWarning) {
      addIssue(
        issues,
        `externalClaimAssessments.${assessment.criterionId}.freshnessWarning`,
        "freshnessWarning must be true when a supporting source is not current.",
      );
    }

    const hasCurrentSupport = supportingSourceRecords.some(
      (source) => source.freshnessStatus === "current",
    );
    const hasPotentiallyCurrentSupport = supportingSourceRecords.some(
      (source) =>
        source.freshnessStatus === "unknown" || source.freshnessStatus === "possibly_stale",
    );
    if (assessment.status === "supported" && !hasCurrentSupport) {
      addIssue(
        issues,
        `externalClaimAssessments.${assessment.criterionId}.status`,
        "supported requires at least one allowed current supporting source.",
      );
    }

    const isSupportAdequacyStatus = [
      "supported",
      "partially_supported",
      "insufficient_sources",
      "not_supported",
    ].includes(assessment.status);
    if (
      isSupportAdequacyStatus &&
      !hasCurrentSupport &&
      hasPotentiallyCurrentSupport &&
      assessment.status !== "partially_supported"
    ) {
      addIssue(
        issues,
        `externalClaimAssessments.${assessment.criterionId}.status`,
        "Only unknown or possibly stale support requires partially_supported status.",
      );
    }
    if (
      isSupportAdequacyStatus &&
      !hasCurrentSupport &&
      !hasPotentiallyCurrentSupport &&
      assessment.status !== "insufficient_sources" &&
      assessment.status !== "not_supported"
    ) {
      addIssue(
        issues,
        `externalClaimAssessments.${assessment.criterionId}.status`,
        "Only stale or absent support requires insufficient_sources or not_supported status.",
      );
    }
  }

  for (const assessment of output.combinedClaimAssessments) {
    validateClaimIdentity("combinedClaimAssessments", assessment);
    validateReferences(
      `combinedClaimAssessments.${assessment.criterionId}.internalEvidenceIds`,
      assessment.internalEvidenceIds,
      evidenceIds,
      issues,
    );
    validateReferences(
      `combinedClaimAssessments.${assessment.criterionId}.contradictingEvidenceIds`,
      assessment.contradictingEvidenceIds,
      evidenceIds,
      issues,
    );
    validateReferences(
      `combinedClaimAssessments.${assessment.criterionId}.externalSourceIds`,
      assessment.externalSourceIds,
      sourceIds,
      issues,
    );

    const criterion = criteria.get(assessment.criterionId);
    const internal = internalByCriterion.get(assessment.criterionId);
    const external = externalByCriterion.get(assessment.criterionId);
    if (criterion !== undefined) {
      if (assessment.evidenceDomain !== criterion.evidenceDomain) {
        addIssue(
          issues,
          `combinedClaimAssessments.${assessment.criterionId}.evidenceDomain`,
          "evidenceDomain must match the supplied criterion.",
        );
      }
      if (assessment.severityIfMissing !== criterion.severityIfMissing) {
        addIssue(
          issues,
          `combinedClaimAssessments.${assessment.criterionId}.severityIfMissing`,
          "severityIfMissing must match the supplied criterion.",
        );
      }
    }
    if (internal !== undefined) {
      if (assessment.internalStatus !== internal.status) {
        addIssue(
          issues,
          `combinedClaimAssessments.${assessment.criterionId}.internalStatus`,
          "Combined internalStatus must match the internal assessment.",
        );
      }
      const expectedInternalEvidenceIds = [
        ...internal.supportingEvidenceIds,
        ...internal.contradictingEvidenceIds,
      ];
      if (!sameStringSet(assessment.internalEvidenceIds, expectedInternalEvidenceIds)) {
        addIssue(
          issues,
          `combinedClaimAssessments.${assessment.criterionId}.internalEvidenceIds`,
          "Combined internalEvidenceIds must match the internal assessment references.",
        );
      }
      if (!sameStringSet(assessment.contradictingEvidenceIds, internal.contradictingEvidenceIds)) {
        addIssue(
          issues,
          `combinedClaimAssessments.${assessment.criterionId}.contradictingEvidenceIds`,
          "Combined contradictingEvidenceIds must match the internal assessment.",
        );
      }
    }
    if (external !== undefined) {
      if (assessment.externalStatus !== external.status) {
        addIssue(
          issues,
          `combinedClaimAssessments.${assessment.criterionId}.externalStatus`,
          "Combined externalStatus must match the external assessment.",
        );
      }
      const expectedSourceIds = [
        ...external.supportingSourceIds,
        ...external.contradictingSourceIds,
      ];
      if (!sameStringSet(assessment.externalSourceIds, expectedSourceIds)) {
        addIssue(
          issues,
          `combinedClaimAssessments.${assessment.criterionId}.externalSourceIds`,
          "Combined externalSourceIds must match the external assessment references.",
        );
      }
    }

    if (
      criterion?.evidenceDomain === "internal" &&
      assessment.externalStatus !== "not_applicable"
    ) {
      addIssue(
        issues,
        `combinedClaimAssessments.${assessment.criterionId}.externalStatus`,
        "Internal-only criteria require externalStatus=not_applicable.",
      );
    }
    if (
      criterion?.evidenceDomain === "external" &&
      assessment.internalStatus !== "not_applicable"
    ) {
      addIssue(
        issues,
        `combinedClaimAssessments.${assessment.criterionId}.internalStatus`,
        "External-only criteria require internalStatus=not_applicable.",
      );
    }
    if (
      criterion?.evidenceDomain === "hybrid" &&
      (assessment.internalStatus === "not_applicable" ||
        assessment.externalStatus === "not_applicable")
    ) {
      addIssue(
        issues,
        `combinedClaimAssessments.${assessment.criterionId}`,
        "Hybrid criteria require both internal and external assessments.",
      );
    }

    const expected = expectedCombinedStatus(assessment);
    if (assessment.combinedStatus !== expected) {
      addIssue(
        issues,
        `combinedClaimAssessments.${assessment.criterionId}.combinedStatus`,
        `combinedStatus must follow deterministic evidence-domain rules (${expected}).`,
      );
    }
  }

  return issues;
}

export function validateAdjudicationResponse(
  response: unknown,
  input: AdjudicationInput,
): AdjudicationOutput {
  const normalizedInput = normalizeInput(input);
  const candidate = parseCandidate(response);
  const parsed = AdjudicationOutputSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AdjudicationValidationError(issuesFromZod(parsed.error), "schema_violation");
  }

  const issues = validateBindings(parsed.data, normalizedInput);
  if (issues.length > 0) {
    throw new AdjudicationValidationError(issues, "binding_violation");
  }
  return parsed.data;
}

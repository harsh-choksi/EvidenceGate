import { z } from "zod";

import {
  CombinedClaimAssessmentSchema,
  type CombinedClaimAssessment,
  CombinedStatusSchema,
  type CombinedStatus,
} from "./assessment.js";
import { IdentifierSchema, NonEmptyTextSchema, addDuplicateIssues } from "./common.js";
import { EvidenceItemSchema, FindingSchema, type EvidenceItem, type Finding } from "./evidence.js";
import { TaskSpecificationSchema, type TaskSpecification } from "./task.js";

export const GateStatusSchema = z.enum([
  "pass",
  "pass_with_warnings",
  "fail",
  "manual_review",
  "analysis_error",
  "source_error",
]);
export type GateStatus = z.infer<typeof GateStatusSchema>;

export const GateDispositionSchema = z.enum([
  "pass",
  "warning",
  "fail",
  "manual_review",
  "analysis_error",
  "source_error",
]);
export type GateDisposition = z.infer<typeof GateDispositionSchema>;

export const GateReasonCodeSchema = z.enum([
  "required_criterion_unsupported",
  "required_criterion_contradicted",
  "required_criterion_partially_verified",
  "required_command_failed",
  "required_evidence_unavailable",
  "critical_finding",
  "conflicting_sources",
  "external_evidence_partial",
  "analysis_error",
  "source_error",
  "optional_criterion_unverified",
  "missing_assessment",
]);
export type GateReasonCode = z.infer<typeof GateReasonCodeSchema>;

export const CriterionGateResultSchema = z
  .object({
    criterionId: IdentifierSchema,
    required: z.boolean(),
    evidenceDomain: z.enum(["internal", "external", "hybrid", "auto"]),
    derivedStatus: CombinedStatusSchema,
    disposition: GateDispositionSchema,
    reasonCodes: z.array(GateReasonCodeSchema),
  })
  .strict();
export type CriterionGateResult = z.infer<typeof CriterionGateResultSchema>;

export const GateDecisionSchema = z
  .object({
    status: GateStatusSchema,
    summary: NonEmptyTextSchema,
    criterionResults: z.array(CriterionGateResultSchema),
    failedCriterionIds: z.array(IdentifierSchema),
    warningCriterionIds: z.array(IdentifierSchema),
    manualReviewCriterionIds: z.array(IdentifierSchema),
    analysisErrorCriterionIds: z.array(IdentifierSchema),
    sourceErrorCriterionIds: z.array(IdentifierSchema),
    reasonCodes: z.array(GateReasonCodeSchema),
  })
  .strict()
  .superRefine((gate, context) => {
    addDuplicateIssues(
      gate.criterionResults.map((result) => result.criterionId),
      context,
      ["criterionResults"],
      "criterion gate result",
    );
    addDuplicateIssues(gate.failedCriterionIds, context, ["failedCriterionIds"], "criterion ID");
    addDuplicateIssues(gate.warningCriterionIds, context, ["warningCriterionIds"], "criterion ID");
    addDuplicateIssues(
      gate.manualReviewCriterionIds,
      context,
      ["manualReviewCriterionIds"],
      "criterion ID",
    );
    addDuplicateIssues(
      gate.analysisErrorCriterionIds,
      context,
      ["analysisErrorCriterionIds"],
      "criterion ID",
    );
    addDuplicateIssues(
      gate.sourceErrorCriterionIds,
      context,
      ["sourceErrorCriterionIds"],
      "criterion ID",
    );

    const expectedLists: Record<Exclude<GateDisposition, "pass">, readonly string[]> = {
      warning: gate.warningCriterionIds,
      fail: gate.failedCriterionIds,
      manual_review: gate.manualReviewCriterionIds,
      analysis_error: gate.analysisErrorCriterionIds,
      source_error: gate.sourceErrorCriterionIds,
    };
    for (const result of gate.criterionResults) {
      if (result.disposition === "pass") continue;
      if (!expectedLists[result.disposition].includes(result.criterionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Criterion ${result.criterionId} is missing from its ${result.disposition} list`,
          path: ["criterionResults"],
        });
      }
    }
  });
export type GateDecision = z.infer<typeof GateDecisionSchema>;

export const GatePolicySchema = z
  .object({
    failOnUnsupportedRequiredCriterion: z.boolean(),
    failOnContradictedRequiredCriterion: z.boolean(),
    failOnRequiredCommandFailure: z.boolean(),
    failOnCriticalFinding: z.boolean(),
    external: z
      .object({
        failOnRequiredSourceError: z.boolean(),
        failOnRequiredExternalContradiction: z.boolean(),
        manualReviewOnConflictingSources: z.boolean(),
        requireBothDomainsForHybridClaims: z.literal(true),
      })
      .strict(),
  })
  .strict();
export type GatePolicy = z.infer<typeof GatePolicySchema>;

export const LEGACY_GATE_POLICY_VERSION = "deterministic-v1" as const;
export const CURRENT_GATE_POLICY_VERSION = "deterministic-v2" as const;

export interface GatePolicyOverrides extends Partial<Omit<GatePolicy, "external">> {
  external?: Partial<GatePolicy["external"]>;
}

export const DEFAULT_GATE_POLICY: Readonly<GatePolicy> = Object.freeze({
  failOnUnsupportedRequiredCriterion: true,
  failOnContradictedRequiredCriterion: true,
  failOnRequiredCommandFailure: true,
  failOnCriticalFinding: true,
  external: Object.freeze({
    failOnRequiredSourceError: true,
    failOnRequiredExternalContradiction: true,
    manualReviewOnConflictingSources: true,
    requireBothDomainsForHybridClaims: true,
  }),
});

export function resolveGatePolicy(overrides: GatePolicyOverrides = {}): GatePolicy {
  return GatePolicySchema.parse({
    ...DEFAULT_GATE_POLICY,
    ...overrides,
    external: {
      ...DEFAULT_GATE_POLICY.external,
      ...overrides.external,
    },
  });
}

export interface GateEvaluationInput {
  task: TaskSpecification;
  combinedClaimAssessments: CombinedClaimAssessment[];
  internalEvidence?: EvidenceItem[];
  findings?: Finding[];
}

const GateEvaluationInputSchema = z
  .object({
    task: TaskSpecificationSchema,
    combinedClaimAssessments: z.array(CombinedClaimAssessmentSchema),
    internalEvidence: z.array(EvidenceItemSchema).optional(),
    findings: z.array(FindingSchema).optional(),
  })
  .strict();

export function deriveCombinedStatus(
  assessment: CombinedClaimAssessment,
  policy: GatePolicy = DEFAULT_GATE_POLICY,
): CombinedStatus {
  const parsed = CombinedClaimAssessmentSchema.parse(assessment);

  if (parsed.evidenceDomain === "internal") {
    switch (parsed.internalStatus) {
      case "verified":
        return "verified";
      case "partially_verified":
        return "partially_verified";
      case "unsupported":
      case "not_applicable":
        return "unsupported";
      case "contradicted":
        return "contradicted";
      case "analysis_error":
        return "analysis_error";
    }
  }

  if (parsed.evidenceDomain === "external") {
    switch (parsed.externalStatus) {
      case "supported":
        return "verified";
      case "partially_supported":
        return "manual_review";
      case "not_supported":
      case "insufficient_sources":
      case "not_applicable":
        return "unsupported";
      case "contradicted":
        return "contradicted";
      case "conflicting_sources":
        return policy.external.manualReviewOnConflictingSources ? "manual_review" : "unsupported";
      case "source_error":
        return "analysis_error";
    }
  }

  if (parsed.internalStatus === "analysis_error" || parsed.externalStatus === "source_error") {
    return "analysis_error";
  }

  if (parsed.internalStatus === "contradicted" || parsed.externalStatus === "contradicted") {
    return "contradicted";
  }

  if (parsed.externalStatus === "conflicting_sources") {
    return policy.external.manualReviewOnConflictingSources ? "manual_review" : "unsupported";
  }

  if (
    parsed.internalStatus === "unsupported" ||
    parsed.internalStatus === "not_applicable" ||
    parsed.externalStatus === "not_supported" ||
    parsed.externalStatus === "insufficient_sources" ||
    parsed.externalStatus === "not_applicable"
  ) {
    return "unsupported";
  }

  if (parsed.externalStatus === "partially_supported") {
    return "manual_review";
  }

  if (parsed.internalStatus === "partially_verified") {
    return "partially_verified";
  }

  if (parsed.internalStatus === "verified" && parsed.externalStatus === "supported") {
    return "verified";
  }

  return "analysis_error";
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort();
}

function isCommandEvidence(evidence: EvidenceItem): boolean {
  return [
    "test_result",
    "build_result",
    "lint_result",
    "typecheck_result",
    "security_result",
    "runtime_probe",
  ].includes(evidence.kind);
}

export function evaluateGate(
  input: GateEvaluationInput,
  overrides: GatePolicyOverrides = {},
): GateDecision {
  const parsedInput = GateEvaluationInputSchema.parse(input);
  const policy = resolveGatePolicy(overrides);
  const assessmentsByCriterion = new Map(
    parsedInput.combinedClaimAssessments.map((assessment) => [assessment.criterionId, assessment]),
  );

  const criterionResults: CriterionGateResult[] = [];

  for (const criterion of parsedInput.task.acceptanceCriteria) {
    const assessment = assessmentsByCriterion.get(criterion.criterionId);
    if (assessment === undefined) {
      criterionResults.push({
        criterionId: criterion.criterionId,
        required: criterion.required,
        evidenceDomain: criterion.evidenceDomain,
        derivedStatus: "analysis_error",
        disposition: criterion.required ? "analysis_error" : "warning",
        reasonCodes: ["missing_assessment"],
      });
      continue;
    }

    const derivedStatus = deriveCombinedStatus(assessment, policy);
    let disposition: GateDisposition = "pass";
    const reasonCodes: GateReasonCode[] = [];

    if (criterion.required) {
      switch (derivedStatus) {
        case "verified":
          break;
        case "partially_verified":
          disposition = "fail";
          reasonCodes.push("required_criterion_partially_verified");
          break;
        case "unsupported":
          disposition = policy.failOnUnsupportedRequiredCriterion ? "fail" : "warning";
          reasonCodes.push("required_criterion_unsupported");
          break;
        case "contradicted": {
          const externalContradiction = assessment.externalStatus === "contradicted";
          const shouldFail = externalContradiction
            ? policy.external.failOnRequiredExternalContradiction
            : policy.failOnContradictedRequiredCriterion;
          disposition = shouldFail ? "fail" : "warning";
          reasonCodes.push("required_criterion_contradicted");
          break;
        }
        case "manual_review":
          disposition = "manual_review";
          reasonCodes.push(
            assessment.externalStatus === "conflicting_sources"
              ? "conflicting_sources"
              : "external_evidence_partial",
          );
          break;
        case "analysis_error":
          if (assessment.externalStatus === "source_error") {
            disposition = policy.external.failOnRequiredSourceError ? "source_error" : "warning";
            reasonCodes.push("source_error");
          } else {
            disposition = "analysis_error";
            reasonCodes.push("analysis_error");
          }
          break;
      }
    } else if (derivedStatus !== "verified") {
      disposition = "warning";
      reasonCodes.push("optional_criterion_unverified");
    }

    criterionResults.push({
      criterionId: criterion.criterionId,
      required: criterion.required,
      evidenceDomain: criterion.evidenceDomain,
      derivedStatus,
      disposition,
      reasonCodes,
    });
  }

  const failedCommands = (parsedInput.internalEvidence ?? []).filter(
    (evidence) =>
      evidence.required === true &&
      isCommandEvidence(evidence) &&
      (evidence.status === "failed" || evidence.status === "unavailable"),
  );
  const criticalFindings = (parsedInput.findings ?? []).filter(
    (finding) => finding.severity === "critical",
  );

  const failedCriterionIds = uniqueSorted(
    criterionResults
      .filter((result) => result.disposition === "fail")
      .map((result) => result.criterionId),
  );
  const warningCriterionIds = uniqueSorted(
    criterionResults
      .filter((result) => result.disposition === "warning")
      .map((result) => result.criterionId),
  );
  const manualReviewCriterionIds = uniqueSorted(
    criterionResults
      .filter((result) => result.disposition === "manual_review")
      .map((result) => result.criterionId),
  );
  const analysisErrorCriterionIds = uniqueSorted(
    criterionResults
      .filter((result) => result.disposition === "analysis_error")
      .map((result) => result.criterionId),
  );
  const sourceErrorCriterionIds = uniqueSorted(
    criterionResults
      .filter((result) => result.disposition === "source_error")
      .map((result) => result.criterionId),
  );

  const hasRequiredCommandFailure =
    policy.failOnRequiredCommandFailure &&
    failedCommands.some((evidence) => evidence.status === "failed");
  const hasUnavailableRequiredEvidence =
    policy.failOnRequiredCommandFailure &&
    failedCommands.some((evidence) => evidence.status === "unavailable");
  const hasCriticalFinding = policy.failOnCriticalFinding && criticalFindings.length > 0;

  let status: GateStatus;
  if (analysisErrorCriterionIds.length > 0) {
    status = "analysis_error";
  } else if (sourceErrorCriterionIds.length > 0) {
    status = "source_error";
  } else if (
    failedCriterionIds.length > 0 ||
    hasRequiredCommandFailure ||
    hasUnavailableRequiredEvidence ||
    hasCriticalFinding
  ) {
    status = "fail";
  } else if (manualReviewCriterionIds.length > 0) {
    status = "manual_review";
  } else if (warningCriterionIds.length > 0) {
    status = "pass_with_warnings";
  } else {
    status = "pass";
  }

  const reasonCodes = uniqueSorted<GateReasonCode>([
    ...criterionResults.flatMap((result) => result.reasonCodes),
    ...(hasRequiredCommandFailure ? (["required_command_failed"] as const) : []),
    ...(hasUnavailableRequiredEvidence ? (["required_evidence_unavailable"] as const) : []),
    ...(hasCriticalFinding ? (["critical_finding"] as const) : []),
  ]);

  const verifiedRequiredCount = criterionResults.filter(
    (result) => result.required && result.derivedStatus === "verified",
  ).length;
  const requiredCount = criterionResults.filter((result) => result.required).length;
  const summary = `${status}: ${verifiedRequiredCount}/${requiredCount} required criteria verified`;

  return GateDecisionSchema.parse({
    status,
    summary,
    criterionResults,
    failedCriterionIds,
    warningCriterionIds,
    manualReviewCriterionIds,
    analysisErrorCriterionIds,
    sourceErrorCriterionIds,
    reasonCodes,
  });
}

export function gateStatusToExitCode(status: GateStatus): number {
  switch (status) {
    case "pass":
    case "pass_with_warnings":
      return 0;
    case "fail":
      return 1;
    case "manual_review":
      return 2;
    case "analysis_error":
      return 3;
    case "source_error":
      return 4;
  }
}

export function evaluateGateForPolicyVersion(
  input: GateEvaluationInput,
  gatePolicyVersion: string,
  gatePolicy?: GatePolicy,
): GateDecision {
  return evaluateGate(input, resolveGatePolicyForVersion(gatePolicyVersion, gatePolicy));
}

export function resolveGatePolicyForVersion(
  gatePolicyVersion: string,
  gatePolicy?: GatePolicy,
): GatePolicy {
  if (gatePolicyVersion === LEGACY_GATE_POLICY_VERSION) {
    if (gatePolicy !== undefined) {
      throw new RangeError(
        `${LEGACY_GATE_POLICY_VERSION} bundles cannot include configurable gate policy inputs`,
      );
    }
    return resolveGatePolicy();
  }

  if (gatePolicyVersion === CURRENT_GATE_POLICY_VERSION) {
    if (gatePolicy === undefined) {
      throw new RangeError(
        `${CURRENT_GATE_POLICY_VERSION} bundles must include the gate policy inputs used for evaluation`,
      );
    }
    return GatePolicySchema.parse(gatePolicy);
  }

  throw new RangeError(`Unsupported gate policy version: ${gatePolicyVersion}`);
}

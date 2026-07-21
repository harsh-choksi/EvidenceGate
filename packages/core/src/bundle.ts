import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  CombinedClaimAssessmentSchema,
  ExternalClaimAssessmentSchema,
  InternalClaimAssessmentSchema,
} from "./assessment.js";
import {
  IdentifierSchema,
  IsoDateTimeSchema,
  NonEmptyTextSchema,
  Sha256Schema,
  addDuplicateIssues,
} from "./common.js";
import { EvidenceItemSchema, FindingSchema, RepositorySnapshotSchema } from "./evidence.js";
import {
  GateDecisionSchema,
  GatePolicySchema,
  deriveCombinedStatus,
  evaluateGate,
  resolveGatePolicyForVersion,
  type GateDecision,
  type GatePolicy,
} from "./gate.js";
import { ExternalSourceRecordSchema, HostnameSchema } from "./source.js";
import { TaskSpecificationSchema } from "./task.js";

export const ResearchRunStatusSchema = z.enum(["completed", "partial", "failed", "cancelled"]);
export type ResearchRunStatus = z.infer<typeof ResearchRunStatusSchema>;

export const ResearchRunMetadataSchema = z
  .object({
    researchRunId: IdentifierSchema,
    criterionIds: z.array(IdentifierSchema),
    model: NonEmptyTextSchema,
    webSearchCallIds: z.array(IdentifierSchema),
    queries: z.array(NonEmptyTextSchema),
    allowedDomains: z.array(HostnameSchema),
    blockedDomains: z.array(HostnameSchema),
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    sourceCount: z.number().int().nonnegative(),
    citationCount: z.number().int().nonnegative(),
    status: ResearchRunStatusSchema,
  })
  .strict()
  .superRefine((run, context) => {
    addDuplicateIssues(run.criterionIds, context, ["criterionIds"], "criterion ID");
    addDuplicateIssues(run.webSearchCallIds, context, ["webSearchCallIds"], "web-search call ID");
    addDuplicateIssues(run.allowedDomains, context, ["allowedDomains"], "allowed domain");
    addDuplicateIssues(run.blockedDomains, context, ["blockedDomains"], "blocked domain");
    if (Date.parse(run.completedAt) < Date.parse(run.startedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "completedAt cannot precede startedAt",
        path: ["completedAt"],
      });
    }
  });
export type ResearchRunMetadata = z.infer<typeof ResearchRunMetadataSchema>;

export const ModelRunPurposeSchema = z.enum([
  "claim_classification",
  "internal_analysis",
  "external_research",
  "evidence_adjudication",
  "other",
]);
export type ModelRunPurpose = z.infer<typeof ModelRunPurposeSchema>;

export const ModelRunMetadataSchema = z
  .object({
    modelRunId: IdentifierSchema,
    criterionIds: z.array(IdentifierSchema),
    purpose: ModelRunPurposeSchema,
    model: NonEmptyTextSchema,
    startedAt: IsoDateTimeSchema,
    completedAt: IsoDateTimeSchema,
    status: ResearchRunStatusSchema,
    responseId: IdentifierSchema.optional(),
    inputHash: Sha256Schema.optional(),
    toolCallIds: z.array(IdentifierSchema),
    error: NonEmptyTextSchema.optional(),
  })
  .strict()
  .superRefine((run, context) => {
    addDuplicateIssues(run.criterionIds, context, ["criterionIds"], "criterion ID");
    addDuplicateIssues(run.toolCallIds, context, ["toolCallIds"], "tool-call ID");
    if (Date.parse(run.completedAt) < Date.parse(run.startedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "completedAt cannot precede startedAt",
        path: ["completedAt"],
      });
    }
  });
export type ModelRunMetadata = z.infer<typeof ModelRunMetadataSchema>;

const EvidenceBundleBaseShape = {
  schemaVersion: z.literal(1),
  bundleId: IdentifierSchema,
  generatedAt: IsoDateTimeSchema,
  toolVersion: NonEmptyTextSchema,
  task: TaskSpecificationSchema,
  repository: RepositorySnapshotSchema,
  internalEvidence: z.array(EvidenceItemSchema),
  externalSources: z.array(ExternalSourceRecordSchema),
  internalClaimAssessments: z.array(InternalClaimAssessmentSchema),
  externalClaimAssessments: z.array(ExternalClaimAssessmentSchema),
  combinedClaimAssessments: z.array(CombinedClaimAssessmentSchema),
  findings: z.array(FindingSchema),
  gate: GateDecisionSchema,
  researchRuns: z.array(ResearchRunMetadataSchema),
  modelRuns: z.array(ModelRunMetadataSchema),
  sourcePolicyVersion: NonEmptyTextSchema,
  gatePolicyVersion: NonEmptyTextSchema,
  gatePolicy: GatePolicySchema.optional(),
};

type BundleIntegrityInput = z.infer<z.ZodObject<typeof EvidenceBundleBaseShape>> & {
  bundleHash?: string;
};

function validateReference(
  id: string,
  known: ReadonlySet<string>,
  context: z.RefinementCtx,
  path: (string | number)[],
  label: string,
): void {
  if (!known.has(id)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unknown ${label}: ${id}`,
      path,
    });
  }
}

function haveSameStringMembers(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value)) &&
    right.every((value) => left.includes(value))
  );
}

function validateBundleIntegrity(bundle: BundleIntegrityInput, context: z.RefinementCtx): void {
  const criterionIds = bundle.task.acceptanceCriteria.map((criterion) => criterion.criterionId);
  const knownCriteria = new Set(criterionIds);
  const evidenceIds = bundle.internalEvidence.map((evidence) => evidence.evidenceId);
  const knownEvidence = new Set(evidenceIds);
  const sourceIds = bundle.externalSources.map((source) => source.sourceId);
  const knownSources = new Set(sourceIds);
  let effectiveGatePolicy: GatePolicy | undefined;
  try {
    effectiveGatePolicy = resolveGatePolicyForVersion(bundle.gatePolicyVersion, bundle.gatePolicy);
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "Unsupported gate policy version",
      path: ["gatePolicyVersion"],
    });
  }

  addDuplicateIssues(evidenceIds, context, ["internalEvidence"], "evidence ID");
  addDuplicateIssues(sourceIds, context, ["externalSources"], "source ID");
  addDuplicateIssues(
    bundle.externalSources.map((source) => source.normalizedUrl),
    context,
    ["externalSources"],
    "normalized source URL",
  );
  addDuplicateIssues(
    bundle.internalClaimAssessments.map((assessment) => assessment.criterionId),
    context,
    ["internalClaimAssessments"],
    "internal assessment criterion ID",
  );
  addDuplicateIssues(
    bundle.externalClaimAssessments.map((assessment) => assessment.criterionId),
    context,
    ["externalClaimAssessments"],
    "external assessment criterion ID",
  );
  addDuplicateIssues(
    bundle.combinedClaimAssessments.map((assessment) => assessment.criterionId),
    context,
    ["combinedClaimAssessments"],
    "combined assessment criterion ID",
  );
  addDuplicateIssues(
    bundle.findings.map((finding) => finding.findingId),
    context,
    ["findings"],
    "finding ID",
  );
  addDuplicateIssues(
    bundle.researchRuns.map((run) => run.researchRunId),
    context,
    ["researchRuns"],
    "research-run ID",
  );
  addDuplicateIssues(
    bundle.modelRuns.map((run) => run.modelRunId),
    context,
    ["modelRuns"],
    "model-run ID",
  );

  const citationIds = bundle.externalSources.flatMap((source) =>
    source.citationAnnotations.map((citation) => citation.citationId),
  );
  addDuplicateIssues(citationIds, context, ["externalSources"], "citation ID");

  const webSearchCallIds = bundle.researchRuns.flatMap((run) => run.webSearchCallIds);
  const knownWebSearchCalls = new Set(webSearchCallIds);
  addDuplicateIssues(webSearchCallIds, context, ["researchRuns"], "web-search call ID");

  bundle.internalEvidence.forEach((evidence, evidenceIndex) => {
    evidence.criterionIds.forEach((criterionId, criterionIndex) =>
      validateReference(
        criterionId,
        knownCriteria,
        context,
        ["internalEvidence", evidenceIndex, "criterionIds", criterionIndex],
        "criterion ID",
      ),
    );
  });

  bundle.externalSources.forEach((source, sourceIndex) => {
    const sourceCallIds = source.webSearchCallIds ?? [source.webSearchCallId];
    sourceCallIds.forEach((callId, callIndex) =>
      validateReference(
        callId,
        knownWebSearchCalls,
        context,
        source.webSearchCallIds === undefined
          ? ["externalSources", sourceIndex, "webSearchCallId"]
          : ["externalSources", sourceIndex, "webSearchCallIds", callIndex],
        "web-search call ID",
      ),
    );
    source.claimsSupported.forEach((criterionId, criterionIndex) =>
      validateReference(
        criterionId,
        knownCriteria,
        context,
        ["externalSources", sourceIndex, "claimsSupported", criterionIndex],
        "criterion ID",
      ),
    );
    source.claimsContradicted.forEach((criterionId, criterionIndex) =>
      validateReference(
        criterionId,
        knownCriteria,
        context,
        ["externalSources", sourceIndex, "claimsContradicted", criterionIndex],
        "criterion ID",
      ),
    );
    source.citationAnnotations.forEach((citation, citationIndex) =>
      validateReference(
        citation.sourceId,
        knownSources,
        context,
        ["externalSources", sourceIndex, "citationAnnotations", citationIndex, "sourceId"],
        "citation source ID",
      ),
    );
  });

  bundle.internalClaimAssessments.forEach((assessment, index) => {
    validateReference(
      assessment.criterionId,
      knownCriteria,
      context,
      ["internalClaimAssessments", index, "criterionId"],
      "criterion ID",
    );
    assessment.supportingEvidenceIds.forEach((id, idIndex) =>
      validateReference(
        id,
        knownEvidence,
        context,
        ["internalClaimAssessments", index, "supportingEvidenceIds", idIndex],
        "evidence ID",
      ),
    );
    assessment.contradictingEvidenceIds.forEach((id, idIndex) =>
      validateReference(
        id,
        knownEvidence,
        context,
        ["internalClaimAssessments", index, "contradictingEvidenceIds", idIndex],
        "evidence ID",
      ),
    );
  });

  bundle.externalClaimAssessments.forEach((assessment, index) => {
    validateReference(
      assessment.criterionId,
      knownCriteria,
      context,
      ["externalClaimAssessments", index, "criterionId"],
      "criterion ID",
    );
    assessment.supportingSourceIds.forEach((id, idIndex) =>
      validateReference(
        id,
        knownSources,
        context,
        ["externalClaimAssessments", index, "supportingSourceIds", idIndex],
        "source ID",
      ),
    );
    assessment.contradictingSourceIds.forEach((id, idIndex) =>
      validateReference(
        id,
        knownSources,
        context,
        ["externalClaimAssessments", index, "contradictingSourceIds", idIndex],
        "source ID",
      ),
    );
  });

  const combinedByCriterion = new Map(
    bundle.combinedClaimAssessments.map((assessment) => [assessment.criterionId, assessment]),
  );
  const internalByCriterion = new Map(
    bundle.internalClaimAssessments.map((assessment) => [assessment.criterionId, assessment]),
  );
  const externalByCriterion = new Map(
    bundle.externalClaimAssessments.map((assessment) => [assessment.criterionId, assessment]),
  );
  bundle.task.acceptanceCriteria.forEach((criterion) => {
    const combinedAssessment = combinedByCriterion.get(criterion.criterionId);
    const internalAssessment = internalByCriterion.get(criterion.criterionId);
    const externalAssessment = externalByCriterion.get(criterion.criterionId);
    const internalIndex = bundle.internalClaimAssessments.findIndex(
      (assessment) => assessment.criterionId === criterion.criterionId,
    );
    const externalIndex = bundle.externalClaimAssessments.findIndex(
      (assessment) => assessment.criterionId === criterion.criterionId,
    );
    const combinedIndex = bundle.combinedClaimAssessments.findIndex(
      (assessment) => assessment.criterionId === criterion.criterionId,
    );

    if (internalAssessment === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Missing internal assessment for criterion: ${criterion.criterionId}`,
        path: ["internalClaimAssessments"],
      });
    } else if (internalAssessment.normalizedClaim !== criterion.text) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Internal normalized claim does not match task criterion ${criterion.criterionId}`,
        path: ["internalClaimAssessments", internalIndex, "normalizedClaim"],
      });
    }

    if (externalAssessment === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Missing external assessment for criterion: ${criterion.criterionId}`,
        path: ["externalClaimAssessments"],
      });
    } else if (externalAssessment.normalizedClaim !== criterion.text) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `External normalized claim does not match task criterion ${criterion.criterionId}`,
        path: ["externalClaimAssessments", externalIndex, "normalizedClaim"],
      });
    }

    if (combinedAssessment === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Missing combined assessment for criterion: ${criterion.criterionId}`,
        path: ["combinedClaimAssessments"],
      });
      return;
    }

    if (combinedAssessment.normalizedClaim !== criterion.text) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Combined normalized claim does not match task criterion ${criterion.criterionId}`,
        path: ["combinedClaimAssessments", combinedIndex, "normalizedClaim"],
      });
    }
    if (
      criterion.evidenceDomain !== "auto" &&
      criterion.evidenceDomain !== combinedAssessment.evidenceDomain
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Combined assessment domain does not match criterion ${criterion.criterionId}`,
        path: ["combinedClaimAssessments", combinedIndex, "evidenceDomain"],
      });
    }

    if (internalAssessment !== undefined) {
      if (combinedAssessment.internalStatus !== internalAssessment.status) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Combined internalStatus does not match internal assessment for criterion ${criterion.criterionId}`,
          path: ["combinedClaimAssessments", combinedIndex, "internalStatus"],
        });
      }
      if (
        !haveSameStringMembers(
          combinedAssessment.internalEvidenceIds,
          internalAssessment.supportingEvidenceIds,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Combined supporting evidence IDs do not match internal assessment for criterion ${criterion.criterionId}`,
          path: ["combinedClaimAssessments", combinedIndex, "internalEvidenceIds"],
        });
      }
      if (
        !haveSameStringMembers(
          combinedAssessment.contradictingEvidenceIds,
          internalAssessment.contradictingEvidenceIds,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Combined contradicting evidence IDs do not match internal assessment for criterion ${criterion.criterionId}`,
          path: ["combinedClaimAssessments", combinedIndex, "contradictingEvidenceIds"],
        });
      }
    }

    if (externalAssessment !== undefined) {
      if (combinedAssessment.externalStatus !== externalAssessment.status) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Combined externalStatus does not match external assessment for criterion ${criterion.criterionId}`,
          path: ["combinedClaimAssessments", combinedIndex, "externalStatus"],
        });
      }
      const expectedExternalSourceIds = [
        ...externalAssessment.supportingSourceIds,
        ...externalAssessment.contradictingSourceIds,
      ];
      if (!haveSameStringMembers(combinedAssessment.externalSourceIds, expectedExternalSourceIds)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Combined external source IDs do not match external assessment for criterion ${criterion.criterionId}`,
          path: ["combinedClaimAssessments", combinedIndex, "externalSourceIds"],
        });
      }
    }

    if (
      effectiveGatePolicy !== undefined &&
      combinedAssessment.combinedStatus !==
        deriveCombinedStatus(combinedAssessment, effectiveGatePolicy)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Combined status does not match deterministic derivation for criterion ${criterion.criterionId}`,
        path: ["combinedClaimAssessments", combinedIndex, "combinedStatus"],
      });
    }
  });

  bundle.combinedClaimAssessments.forEach((assessment, index) => {
    validateReference(
      assessment.criterionId,
      knownCriteria,
      context,
      ["combinedClaimAssessments", index, "criterionId"],
      "criterion ID",
    );
    assessment.internalEvidenceIds.forEach((id, idIndex) =>
      validateReference(
        id,
        knownEvidence,
        context,
        ["combinedClaimAssessments", index, "internalEvidenceIds", idIndex],
        "evidence ID",
      ),
    );
    assessment.contradictingEvidenceIds.forEach((id, idIndex) =>
      validateReference(
        id,
        knownEvidence,
        context,
        ["combinedClaimAssessments", index, "contradictingEvidenceIds", idIndex],
        "evidence ID",
      ),
    );
    assessment.externalSourceIds.forEach((id, idIndex) =>
      validateReference(
        id,
        knownSources,
        context,
        ["combinedClaimAssessments", index, "externalSourceIds", idIndex],
        "source ID",
      ),
    );
  });

  bundle.findings.forEach((finding, index) => {
    finding.criterionIds.forEach((id, idIndex) =>
      validateReference(
        id,
        knownCriteria,
        context,
        ["findings", index, "criterionIds", idIndex],
        "criterion ID",
      ),
    );
    finding.evidenceIds.forEach((id, idIndex) =>
      validateReference(
        id,
        knownEvidence,
        context,
        ["findings", index, "evidenceIds", idIndex],
        "evidence ID",
      ),
    );
    finding.sourceIds.forEach((id, idIndex) =>
      validateReference(
        id,
        knownSources,
        context,
        ["findings", index, "sourceIds", idIndex],
        "source ID",
      ),
    );
  });

  bundle.researchRuns.forEach((run, index) => {
    run.criterionIds.forEach((id, idIndex) =>
      validateReference(
        id,
        knownCriteria,
        context,
        ["researchRuns", index, "criterionIds", idIndex],
        "criterion ID",
      ),
    );

    const sourcesForRun = bundle.externalSources.filter((source) =>
      (source.webSearchCallIds ?? [source.webSearchCallId]).some((callId) =>
        run.webSearchCallIds.includes(callId),
      ),
    );
    const citationsForRun = sourcesForRun.reduce(
      (count, source) => count + source.citationAnnotations.length,
      0,
    );
    if (run.sourceCount !== sourcesForRun.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Research-run sourceCount does not match its source records`,
        path: ["researchRuns", index, "sourceCount"],
      });
    }
    if (run.citationCount !== citationsForRun) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Research-run citationCount does not match its citation records`,
        path: ["researchRuns", index, "citationCount"],
      });
    }
  });

  const externalResearchToolCallOwners = new Map<string, number>();
  bundle.modelRuns.forEach((run, index) => {
    run.criterionIds.forEach((id, idIndex) =>
      validateReference(
        id,
        knownCriteria,
        context,
        ["modelRuns", index, "criterionIds", idIndex],
        "criterion ID",
      ),
    );

    if (run.purpose === "external_research") {
      run.toolCallIds.forEach((toolCallId, toolCallIndex) => {
        validateReference(
          toolCallId,
          knownWebSearchCalls,
          context,
          ["modelRuns", index, "toolCallIds", toolCallIndex],
          "web-search call ID",
        );
        const previousOwner = externalResearchToolCallOwners.get(toolCallId);
        if (previousOwner !== undefined && previousOwner !== index) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `External-research tool-call ID is already assigned to modelRuns[${previousOwner}]: ${toolCallId}`,
            path: ["modelRuns", index, "toolCallIds", toolCallIndex],
          });
        } else {
          externalResearchToolCallOwners.set(toolCallId, index);
        }
      });
    }
  });

  const gateCriterionIds = bundle.gate.criterionResults.map((result) => result.criterionId);
  const gateReferencedIds = [
    ...gateCriterionIds,
    ...bundle.gate.failedCriterionIds,
    ...bundle.gate.warningCriterionIds,
    ...bundle.gate.manualReviewCriterionIds,
    ...bundle.gate.analysisErrorCriterionIds,
    ...bundle.gate.sourceErrorCriterionIds,
  ];
  gateReferencedIds.forEach((id) =>
    validateReference(id, knownCriteria, context, ["gate"], "gate criterion ID"),
  );
  for (const id of criterionIds) {
    if (!gateCriterionIds.includes(id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Missing gate result for criterion: ${id}`,
        path: ["gate", "criterionResults"],
      });
    }
  }

  if (bundle.repository.repositoryPath !== bundle.task.repositoryPath) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Repository snapshot path must match task repositoryPath",
      path: ["repository", "repositoryPath"],
    });
  }
  if (bundle.repository.baseRef !== bundle.task.baseRef) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Repository snapshot baseRef must match task baseRef",
      path: ["repository", "baseRef"],
    });
  }
  if (bundle.repository.headRef !== bundle.task.headRef) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Repository snapshot headRef must match task headRef",
      path: ["repository", "headRef"],
    });
  }

  if (effectiveGatePolicy === undefined) return;

  let expectedGate: GateDecision;
  try {
    expectedGate = evaluateGate(
      {
        task: bundle.task,
        combinedClaimAssessments: bundle.combinedClaimAssessments,
        internalEvidence: bundle.internalEvidence,
        findings: bundle.findings,
      },
      effectiveGatePolicy,
    );
  } catch (error) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "Unsupported gate policy version",
      path: ["gatePolicyVersion"],
    });
    return;
  }

  if (!isDeepStrictEqual(bundle.gate, expectedGate)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Stored gate does not exactly match the deterministic evaluation of this bundle's evidence",
      path: ["gate"],
    });
  }
}

export const UnsignedEvidenceBundleSchema = z
  .object(EvidenceBundleBaseShape)
  .strict()
  .superRefine(validateBundleIntegrity);
export type UnsignedEvidenceBundle = z.infer<typeof UnsignedEvidenceBundleSchema>;

export const EvidenceBundleSchema = z
  .object({
    ...EvidenceBundleBaseShape,
    bundleHash: Sha256Schema,
  })
  .strict()
  .superRefine(validateBundleIntegrity);
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

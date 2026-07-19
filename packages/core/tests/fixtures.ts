import type {
  CombinedClaimAssessment,
  TaskSpecification,
  UnsignedEvidenceBundle,
} from "../src/index.js";
import { evaluateGate } from "../src/index.js";

const NOW = "2026-07-18T06:00:00.000Z";

export function makeTask(
  evidenceDomain: "internal" | "external" | "hybrid" | "auto" = "hybrid",
  required = true,
): TaskSpecification {
  return {
    schemaVersion: 1,
    taskId: "task-1",
    title: "Verify sourced answers",
    problemStatement: "The implementation must satisfy its sourced-answer requirement.",
    acceptanceCriteria: [
      {
        criterionId: "criterion-1",
        text: "Use the current documented API correctly.",
        category: "api_compatibility",
        required,
        evidenceDomain,
      },
    ],
    baseRef: "main",
    headRef: "HEAD",
    repositoryPath: "/repo",
    createdAt: NOW,
    sourceMode: "required",
    defaultSourcePolicy: "official_only",
  };
}

export function makeCombinedAssessment(
  overrides: Partial<CombinedClaimAssessment> = {},
): CombinedClaimAssessment {
  return {
    criterionId: "criterion-1",
    normalizedClaim: "Use the current documented API correctly.",
    evidenceDomain: "hybrid",
    internalStatus: "verified",
    externalStatus: "supported",
    combinedStatus: "verified",
    internalEvidenceIds: ["evidence-1"],
    externalSourceIds: ["source-1"],
    contradictingEvidenceIds: [],
    missingEvidence: [],
    explanation: "Both evidence domains support the claim.",
    severityIfMissing: "high",
    ...overrides,
  };
}

export function makeUnsignedBundle(): UnsignedEvidenceBundle {
  const task = makeTask();
  const internalEvidence = [
    {
      evidenceId: "evidence-1",
      criterionIds: ["criterion-1"],
      kind: "test_result" as const,
      status: "passed" as const,
      summary: "Integration test passed.",
      required: true,
      capturedAt: NOW,
    },
  ];
  const combinedClaimAssessments = [makeCombinedAssessment()];
  const gate = evaluateGate({ task, internalEvidence, combinedClaimAssessments });

  return {
    schemaVersion: 1,
    bundleId: "bundle-1",
    generatedAt: NOW,
    toolVersion: "0.1.0",
    task,
    repository: {
      repositoryPath: "/repo",
      baseRef: "main",
      headRef: "HEAD",
      headCommit: "0123456789abcdef",
      capturedAt: NOW,
      isDirty: false,
      changedFiles: [],
    },
    internalEvidence,
    externalSources: [
      {
        sourceId: "source-1",
        webSearchCallId: "search-call-1",
        url: "https://developers.openai.com/docs",
        normalizedUrl: "https://developers.openai.com/docs",
        title: "Official API documentation",
        domain: "developers.openai.com",
        publisher: "OpenAI",
        retrievedAt: NOW,
        sourceType: "official_documentation",
        isPrimary: true,
        isOfficial: true,
        allowedByPolicy: true,
        freshnessStatus: "current",
        citationAnnotations: [
          {
            citationId: "citation-1",
            sourceId: "source-1",
            startIndex: 0,
            endIndex: 8,
            citedText: "Official",
          },
        ],
        claimsSupported: ["criterion-1"],
        claimsContradicted: [],
        limitations: [],
      },
    ],
    internalClaimAssessments: [
      {
        criterionId: "criterion-1",
        normalizedClaim: "Use the current documented API correctly.",
        status: "verified",
        supportingEvidenceIds: ["evidence-1"],
        contradictingEvidenceIds: [],
        missingEvidence: [],
        explanation: "The integration test exercises the implementation.",
      },
    ],
    externalClaimAssessments: [
      {
        criterionId: "criterion-1",
        normalizedClaim: "Use the current documented API correctly.",
        status: "supported",
        supportingSourceIds: ["source-1"],
        contradictingSourceIds: [],
        requiredSourceTypes: ["official_documentation"],
        missingSourceTypes: [],
        freshnessWarning: false,
        explanation: "Current official documentation supports the requirement.",
        unresolvedQuestions: [],
      },
    ],
    combinedClaimAssessments,
    findings: [],
    gate,
    researchRuns: [
      {
        researchRunId: "research-run-1",
        criterionIds: ["criterion-1"],
        model: "gpt-5.6",
        webSearchCallIds: ["search-call-1"],
        queries: ["site:developers.openai.com Responses API"],
        allowedDomains: ["developers.openai.com"],
        blockedDomains: [],
        startedAt: NOW,
        completedAt: NOW,
        sourceCount: 1,
        citationCount: 1,
        status: "completed",
      },
    ],
    modelRuns: [],
    sourcePolicyVersion: "1",
    gatePolicyVersion: "deterministic-v1",
  };
}

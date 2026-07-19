import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseConfig, type EvidenceGateConfig } from "@evidencegate/config";
import {
  CURRENT_GATE_POLICY_VERSION,
  TaskSpecificationSchema,
  parseEvidenceBundle,
  sha256Canonical,
  type AcceptanceCriterion,
  type TaskSpecification,
} from "@evidencegate/core";
import type { RepositorySnapshot as GitRepositorySnapshot } from "@evidencegate/git";
import type { CommandResult } from "@evidencegate/runner";
import {
  sourceIdForNormalizedUrl,
  type ExternalSourceRecord as ResearchSourceRecord,
  type SourceResearchResult,
} from "@evidencegate/source-research";
import { describe, expect, it } from "vitest";

import {
  analyzeRepositoryWithHints,
  buildSourcePlans,
  computeApprovedSourceResultHash,
  createApprovedSourceResultsArtifact,
  isPathInScope,
  parseApprovedSourceResultsArtifact,
  runEvidenceGateWorkflow,
} from "../src/index.js";

const NOW = "2026-07-18T07:00:00.000Z";
const SOURCE_URL = "https://developers.openai.com/api/docs/guides/tools-web-search";
const SOURCE_ID = sourceIdForNormalizedUrl(SOURCE_URL);

function makeConfig(
  overrides: {
    sourceMode?: "off" | "requested" | "required" | "automatic_for_external_claims";
    commands?: Record<
      string,
      { command: string; enabled: boolean; timeoutSeconds: number; required: boolean }
    >;
    maxSourceAgeDays?: number | null;
  } = {},
): EvidenceGateConfig {
  return parseConfig({
    version: 1,
    repository: { baseRef: "main", headRef: "HEAD" },
    commands: overrides.commands ?? {},
    analysis: {
      model: "gpt-5.6",
      maxChangedFiles: 20,
      maxDiffBytes: 100_000,
      redactSecrets: true,
    },
    sources: {
      mode: overrides.sourceMode ?? "requested",
      provider: "openai_web_search",
      defaultPolicy: "primary_sources",
      previewRequired: true,
      maximumClaimsPerRun: 4,
      maximumSearchQueriesPerClaim: 2,
      minimumSourceCount: 1,
      storeSourceMetadata: true,
      storeResearchNarrative: true,
      storeFullPageContent: false,
      policies: {
        official_only: {
          sourcePolicy: "official_only",
          allowedDomains: ["developers.openai.com", "platform.openai.com"],
          blockedDomains: ["example.com"],
          minimumSourceCount: 1,
          maxSourceAgeDays:
            overrides.maxSourceAgeDays === undefined ? 30 : overrides.maxSourceAgeDays,
        },
      },
    },
    gate: {
      failOnUnsupportedRequiredCriterion: true,
      failOnContradictedRequiredCriterion: true,
      failOnRequiredCommandFailure: true,
      failOnCriticalFinding: true,
      external: {
        failOnRequiredSourceError: true,
        failOnRequiredExternalContradiction: true,
        manualReviewOnConflictingSources: true,
        requireBothDomainsForHybridClaims: true,
      },
    },
    privacy: { excludedPaths: ["secrets/**", "**/*.pem"] },
    report: {
      outputDirectory: ".evidencegate/reports",
      showClickableSources: true,
      showSearchQueries: true,
      showSourcePolicy: true,
      includeRawCommandOutput: false,
    },
  });
}

function makeTask(
  criterion: AcceptanceCriterion,
  overrides: Partial<TaskSpecification> = {},
): TaskSpecification {
  return TaskSpecificationSchema.parse({
    schemaVersion: 1,
    taskId: "task-workflow",
    title: "Verify a user change",
    problemStatement: "Evaluate this repository change against explicit acceptance criteria.",
    acceptanceCriteria: [criterion],
    baseRef: "main",
    headRef: "HEAD",
    repositoryPath: ".",
    createdAt: NOW,
    sourceMode: "requested",
    defaultSourcePolicy: "official_only",
    ...overrides,
  });
}

function criterion(overrides: Partial<AcceptanceCriterion> = {}): AcceptanceCriterion {
  return {
    criterionId: "criterion-api",
    text: "Use the current OpenAI Responses API.",
    category: "api_compatibility",
    required: true,
    evidenceDomain: "hybrid",
    verificationHints: ["client.responses.create"],
    externalEvidence: {
      mode: "required",
      sourcePolicy: "official_only",
    },
    ...overrides,
  };
}

function makeRepository(source: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "evidencegate-workflow-"));
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src", "feature.ts"), source, "utf8");
  return root;
}

function snapshot(repositoryRoot: string): GitRepositorySnapshot {
  return {
    repositoryRoot,
    baseRef: "main",
    headRef: "HEAD",
    headSha: "0123456789abcdef",
    branch: "feature",
    isDirty: false,
    changedFiles: [{ path: "src/feature.ts", status: "modified" }],
    diff: "+ client.responses.create()",
    diffBytes: 27,
    diffTruncated: false,
    capturedAt: NOW,
  };
}

function passingCommand(): CommandResult {
  return {
    commandId: "test",
    command: "pnpm test",
    required: true,
    status: "passed",
    exitCode: 0,
    durationMs: 10,
    stdout: "ok",
    stderr: "",
    outputTruncated: false,
    startedAt: NOW,
    completedAt: NOW,
  };
}

function researchResult(
  source: ResearchSourceRecord,
  criterionId = "criterion-api",
): SourceResearchResult {
  return {
    narrative: "Responses API current official documentation supports the cited requirement.",
    registry: {
      sources: [source],
      citations: [...source.citationAnnotations],
      issues: [],
      valid: true,
    },
    conflicts: [],
    metadata: {
      researchRunId: "research-native-1",
      criterionIds: [criterionId],
      model: "gpt-5.6",
      webSearchCallIds: [source.webSearchCallId],
      queries: ["OpenAI Responses API official docs"],
      allowedDomains: ["developers.openai.com", "platform.openai.com"],
      blockedDomains: ["example.com"],
      startedAt: NOW,
      completedAt: NOW,
      sourceCount: 1,
      citationCount: source.citationAnnotations.length,
      status: "completed",
    },
  };
}

function source(overrides: Partial<ResearchSourceRecord> = {}): ResearchSourceRecord {
  return {
    sourceId: SOURCE_ID,
    webSearchCallId: "search-call-1",
    url: SOURCE_URL,
    normalizedUrl: SOURCE_URL,
    title: "Web search | OpenAI API",
    domain: "developers.openai.com",
    publisher: "OpenAI",
    publishedAt: NOW,
    retrievedAt: NOW,
    sourceType: "official_documentation",
    isPrimary: true,
    isOfficial: true,
    allowedByPolicy: true,
    freshnessStatus: "current",
    citationAnnotations: [
      {
        citationId: "citation-native-1",
        sourceId: SOURCE_ID,
        startIndex: 0,
        endIndex: 13,
        citedText: "Responses API",
      },
    ],
    claimsSupported: [],
    claimsContradicted: [],
    limitations: [],
    ...overrides,
  };
}

function approvedArtifact(
  task: TaskSpecification,
  config: EvidenceGateConfig,
  result = researchResult(source()),
) {
  const plans = buildSourcePlans(task, config);
  const criterionId = result.metadata.criterionIds[0];
  const plan = plans.find((candidate) => candidate.criterionId === criterionId);
  if (plan === undefined) throw new Error("Expected a matching source plan fixture.");
  const normalizedResult: SourceResearchResult = {
    ...result,
    metadata: {
      ...result.metadata,
      queries: plan.queries.map((query) => query.query),
      allowedDomains: [...plan.allowedDomains],
      blockedDomains: [...plan.blockedDomains],
      sourceCount: result.registry.sources.length,
      citationCount: result.registry.citations.length,
    },
  };
  return createApprovedSourceResultsArtifact(task, config, plans, [normalizedResult], NOW);
}

describe("source planning", () => {
  it("honors criterion policy overrides, explicit queries, publisher preferences, and selection", () => {
    const task = makeTask(
      criterion({
        externalEvidence: {
          mode: "required",
          sourcePolicy: "official_only",
          allowedDomains: ["platform.openai.com"],
          blockedDomains: ["blocked.example"],
          maxSourceAgeDays: 7,
          minimumSourceCount: 2,
          preferredPublishers: ["OpenAI"],
          userQuery: "Responses API docs for owner@example.com",
        },
      }),
    );
    const [plan] = buildSourcePlans(task, makeConfig(), {
      selectedCriterionIds: ["criterion-api"],
    });

    expect(plan?.allowedDomains).toEqual(["platform.openai.com"]);
    expect(plan?.blockedDomains).toEqual(["blocked.example", "example.com"]);
    expect(plan?.minimumSourceCount).toBe(2);
    expect(plan?.maxSourceAgeDays).toBe(7);
    expect(plan?.queries[0]?.query).not.toContain("owner@example.com");
    expect(plan?.rationale).toContain("Prefer sources published by: OpenAI");
    expect(plan?.requiresUserApproval).toBe(true);
    expect(() =>
      buildSourcePlans(task, makeConfig(), { selectedCriterionIds: ["unknown"] }),
    ).toThrow(/Unknown criterion selection/u);
  });
});

describe("approved source artifact integrity", () => {
  it("binds the artifact to the exact expected plans, not a self-consistent forged plan hash", () => {
    const task = makeTask(criterion(), { sourceMode: "required" });
    const config = makeConfig();
    const artifact = approvedArtifact(task, config);
    const forged = structuredClone(artifact);
    const firstPlan = forged.plans[0];
    if (firstPlan === undefined) throw new Error("Expected a source plan fixture.");
    firstPlan.minimumSourceCount = 99;
    firstPlan.sourcePolicy.minimumSourceCount = 99;
    forged.planHash = sha256Canonical(forged.plans);
    forged.resultHash = computeApprovedSourceResultHash(forged);

    expect(() => parseApprovedSourceResultsArtifact(forged, task, config)).toThrow(
      /plan|artifact|policy/iu,
    );
  });

  it("does not support a criterion from a semantically unrelated native citation", async () => {
    const task = makeTask(criterion(), { sourceMode: "required" });
    const config = makeConfig();
    const unrelatedSource = source({
      citationAnnotations: [
        {
          citationId: "citation-native-unrelated",
          sourceId: SOURCE_ID,
          startIndex: 0,
          endIndex: 18,
          citedText: "structured outputs",
        },
      ],
    });
    const unrelatedResult = researchResult(unrelatedSource, "criterion-api");
    unrelatedResult.narrative = "structured outputs";

    let artifact: ReturnType<typeof createApprovedSourceResultsArtifact>;
    try {
      artifact = approvedArtifact(task, config, unrelatedResult);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      return;
    }

    const root = makeRepository("export const run = () => client.responses.create({});\n");
    const outcome = await runEvidenceGateWorkflow({
      cwd: root,
      task,
      config,
      approvedSources: artifact,
      generatedAt: new Date(NOW),
      dependencies: {
        collectSnapshot: () => snapshot(root),
        executeCommands: () => Promise.resolve([]),
      },
    }).then(
      (result) => result.bundle.externalClaimAssessments[0]?.status,
      () => "rejected" as const,
    );

    expect(outcome).not.toBe("supported");
  });

  it("rejects a native citation relabeled to support an unrelated criterion", async () => {
    const otherCriterion = criterion({
      criterionId: "criterion-structured-output",
      text: "Use strict JSON Schema structured outputs.",
      verificationHints: ["text.format"],
    });
    const task = makeTask(criterion(), {
      sourceMode: "required",
      acceptanceCriteria: [criterion(), otherCriterion],
    });
    const config = makeConfig();
    const otherSource = source({
      citationAnnotations: [
        {
          citationId: "citation-native-other",
          sourceId: SOURCE_ID,
          startIndex: 0,
          endIndex: 18,
          citedText: "structured outputs",
        },
      ],
    });
    const otherResult = researchResult(otherSource, otherCriterion.criterionId);
    otherResult.narrative = "structured outputs";
    const artifact = approvedArtifact(task, config, otherResult);
    const forged = structuredClone(artifact);
    const forgedSource = forged.results[0]?.registry.sources[0];
    if (forgedSource === undefined) throw new Error("Expected a source fixture.");
    forgedSource.claimsSupported = ["criterion-api"];
    forged.resultHash = computeApprovedSourceResultHash(forged);

    expect(() => parseApprovedSourceResultsArtifact(forged, task, config)).toThrow(
      /criterion|claim|artifact|binding|results|validation/iu,
    );

    const root = makeRepository("export const run = () => client.responses.create({});\n");
    await expect(
      runEvidenceGateWorkflow({
        cwd: root,
        task,
        config,
        approvedSources: forged,
        generatedAt: new Date(NOW),
        dependencies: {
          collectSnapshot: () => snapshot(root),
          executeCommands: () => Promise.resolve([]),
        },
      }),
    ).rejects.toThrow(/criterion|claim|artifact|binding|results|validation/iu);
  });

  it.each([
    {
      name: "domain and policy acceptance",
      mutate: (record: ResearchSourceRecord) => {
        record.url = "https://example.com/forged";
        record.normalizedUrl = "https://example.com/forged";
        record.domain = "example.com";
        record.allowedByPolicy = true;
      },
    },
    {
      name: "authority type",
      mutate: (record: ResearchSourceRecord) => {
        record.sourceType = "community";
        record.isPrimary = true;
        record.isOfficial = true;
        record.allowedByPolicy = true;
      },
    },
    {
      name: "freshness",
      mutate: (record: ResearchSourceRecord) => {
        record.publishedAt = "2020-01-01T00:00:00.000Z";
        record.freshnessStatus = "current";
        record.allowedByPolicy = true;
      },
    },
  ])("rejects forged $name fields in persisted source records", ({ mutate }) => {
    const task = makeTask(criterion(), { sourceMode: "required" });
    const config = makeConfig();
    const artifact = approvedArtifact(task, config);
    const forged = structuredClone(artifact);
    const forgedSource = forged.results[0]?.registry.sources[0];
    if (forgedSource === undefined) throw new Error("Expected a source fixture.");
    mutate(forgedSource);
    forged.resultHash = computeApprovedSourceResultHash(forged);

    expect(() => parseApprovedSourceResultsArtifact(forged, task, config)).toThrow(
      /source|policy|domain|authority|freshness|artifact|metadata|registry|validation/iu,
    );
  });
});

describe("generic hint analysis", () => {
  it("does not treat comments, prose, or an unconfigured criterion as implementation proof", () => {
    const root = makeRepository("// client.responses.create()\nexport const value = 1;\n");
    writeFileSync(path.join(root, "README.md"), "client.responses.create", "utf8");
    const result = analyzeRepositoryWithHints(
      root,
      [criterion(), criterion({ criterionId: "unknown", verificationHints: undefined })],
      ["src/feature.ts", "README.md"],
      NOW,
    );

    expect(result.assessments.map((assessment) => assessment.status)).toEqual([
      "unsupported",
      "unsupported",
    ]);
    expect(result.assessments[1]?.status).not.toBe("analysis_error");
  });

  it("matches configured hints in executable changed files and respects path scope", () => {
    const root = makeRepository("export const run = () => client.responses.create({});\n");
    const result = analyzeRepositoryWithHints(
      root,
      [criterion({ evidenceDomain: "internal" })],
      ["src/feature.ts"],
      NOW,
    );
    const task = makeTask(criterion(), {
      includePaths: ["src/**"],
      excludePaths: ["src/generated/**"],
    });

    expect(result.assessments[0]?.status).toBe("verified");
    expect(isPathInScope("src/feature.ts", task, makeConfig())).toBe(true);
    expect(isPathInScope("src/generated/client.ts", task, makeConfig())).toBe(false);
    expect(isPathInScope("secrets/key.txt", task, makeConfig())).toBe(false);
  });
});

describe("evidence bundle workflow", () => {
  it("captures bounded workflow evidence and produces a valid default bundle", async () => {
    const root = makeRepository("export const run = () => client.responses.create({});\n");
    const task = makeTask(
      criterion({ evidenceDomain: "internal", externalEvidence: { mode: "off" } }),
      {
        sourceMode: "off",
      },
    );
    const config = makeConfig({
      sourceMode: "off",
      commands: {
        test: { command: "pnpm test", enabled: true, timeoutSeconds: 30, required: true },
      },
    });
    const result = await runEvidenceGateWorkflow({
      cwd: root,
      task,
      config,
      generatedAt: new Date(NOW),
      dependencies: {
        collectSnapshot: () => snapshot(root),
        executeCommands: () => Promise.resolve([passingCommand()]),
      },
    });

    expect(result.bundle.gate.status).toBe("pass");
    expect(result.bundle.repository.changedFiles).toHaveLength(1);
    expect(result.bundle.internalEvidence.some((item) => item.kind === "test_result")).toBe(true);
    expect(parseEvidenceBundle(result.bundle).bundleHash).toBe(result.bundle.bundleHash);
  });

  it("stores and applies non-default gate policy inputs without rewriting evidence metadata", async () => {
    const root = makeRepository("export const run = () => client.responses.create({});\n");
    const task = makeTask(
      criterion({ evidenceDomain: "internal", externalEvidence: { mode: "off" } }),
      { sourceMode: "off" },
    );
    const config = makeConfig({
      sourceMode: "off",
      commands: {
        test: { command: "pnpm test", enabled: true, timeoutSeconds: 30, required: true },
      },
    });
    config.gate.failOnRequiredCommandFailure = false;
    const failedCommand: CommandResult = {
      ...passingCommand(),
      status: "failed",
      exitCode: 1,
      stdout: "failed",
    };
    const result = await runEvidenceGateWorkflow({
      cwd: root,
      task,
      config,
      generatedAt: new Date(NOW),
      dependencies: {
        collectSnapshot: () => snapshot(root),
        executeCommands: () => Promise.resolve([failedCommand]),
      },
    });

    const commandEvidence = result.bundle.internalEvidence.find(
      (item) => item.kind === "test_result",
    );
    expect(commandEvidence?.required).toBe(true);
    expect(result.bundle.gate.status).toBe("pass");
    expect(result.bundle.gate.reasonCodes).not.toContain("required_command_failed");
    expect(result.bundle.gatePolicyVersion).toBe(CURRENT_GATE_POLICY_VERSION);
    expect(result.bundle.gatePolicy).toEqual(config.gate);
    expect(parseEvidenceBundle(result.bundle).bundleHash).toBe(result.bundle.bundleHash);
  });

  it("applies configured unsupported-criterion handling", async () => {
    const root = makeRepository("export const unrelated = true;\n");
    const task = makeTask(
      criterion({ evidenceDomain: "internal", externalEvidence: { mode: "off" } }),
      { sourceMode: "off" },
    );
    const config = makeConfig({ sourceMode: "off" });
    config.gate.failOnUnsupportedRequiredCriterion = false;
    const result = await runEvidenceGateWorkflow({
      cwd: root,
      task,
      config,
      generatedAt: new Date(NOW),
      dependencies: {
        collectSnapshot: () => snapshot(root),
        executeCommands: () => Promise.resolve([]),
      },
    });

    expect(result.bundle.combinedClaimAssessments[0]?.combinedStatus).toBe("unsupported");
    expect(result.bundle.gate.status).toBe("pass_with_warnings");
    expect(result.bundle.gatePolicy?.failOnUnsupportedRequiredCriterion).toBe(false);
    expect(parseEvidenceBundle(result.bundle).gate.status).toBe("pass_with_warnings");
  });

  it("uses the configured policy when deriving a conflicting combined status", async () => {
    const root = makeRepository("export const run = () => client.responses.create({});\n");
    const task = makeTask(criterion(), { sourceMode: "required" });
    const config = makeConfig();
    config.gate.external.manualReviewOnConflictingSources = false;
    const supportText = "Responses API";
    const contradictionText = "Responses API does not support this requirement";
    const narrative = `${supportText} is documented here. ${contradictionText}.`;
    const contradictionUrl = "https://platform.openai.com/docs/api-reference/responses";
    const supportingSource = source({ publishedAt: NOW });
    const contradictingSource = source({
      sourceId: sourceIdForNormalizedUrl(contradictionUrl),
      webSearchCallId: "search-call-2",
      url: contradictionUrl,
      normalizedUrl: contradictionUrl,
      domain: "platform.openai.com",
      title: "Responses API reference",
      publishedAt: NOW,
      citationAnnotations: [
        {
          citationId: "citation-native-2",
          sourceId: sourceIdForNormalizedUrl(contradictionUrl),
          startIndex: narrative.indexOf(contradictionText),
          endIndex: narrative.indexOf(contradictionText) + contradictionText.length,
          citedText: contradictionText,
        },
      ],
    });
    const baseResult = researchResult(supportingSource);
    const conflictResult: SourceResearchResult = {
      ...baseResult,
      narrative,
      registry: {
        ...baseResult.registry,
        sources: [supportingSource, contradictingSource],
        citations: [
          ...supportingSource.citationAnnotations,
          ...contradictingSource.citationAnnotations,
        ],
      },
      metadata: {
        ...baseResult.metadata,
        webSearchCallIds: [supportingSource.webSearchCallId, contradictingSource.webSearchCallId],
        sourceCount: 2,
        citationCount: 2,
      },
    };
    const artifact = approvedArtifact(task, config, conflictResult);
    const result = await runEvidenceGateWorkflow({
      cwd: root,
      task,
      config,
      approvedSources: artifact,
      generatedAt: new Date(NOW),
      dependencies: {
        collectSnapshot: () => snapshot(root),
        executeCommands: () => Promise.resolve([]),
      },
    });

    expect(result.bundle.externalClaimAssessments[0]?.status).toBe("conflicting_sources");
    expect(result.bundle.combinedClaimAssessments[0]?.combinedStatus).toBe("unsupported");
    expect(result.bundle.gate.status).toBe("fail");
    expect(parseEvidenceBundle(result.bundle).gate.status).toBe("fail");
  });

  it("fails closed when required approved source results are absent", async () => {
    const root = makeRepository("export const run = () => client.responses.create({});\n");
    const task = makeTask(criterion(), { sourceMode: "required" });
    const result = await runEvidenceGateWorkflow({
      cwd: root,
      task,
      config: makeConfig(),
      generatedAt: new Date(NOW),
      dependencies: {
        collectSnapshot: () => snapshot(root),
        executeCommands: () => Promise.resolve([]),
      },
    });

    expect(result.bundle.externalClaimAssessments[0]?.status).toBe("source_error");
    expect(result.bundle.gate.status).toBe("source_error");
  });

  it("binds only native cited sources from a single approved criterion", async () => {
    const root = makeRepository("export const run = () => client.responses.create({});\n");
    const task = makeTask(criterion(), { sourceMode: "required" });
    const config = makeConfig();
    const artifact = approvedArtifact(task, config);
    const result = await runEvidenceGateWorkflow({
      cwd: root,
      task,
      config,
      approvedSources: artifact,
      generatedAt: new Date(NOW),
      dependencies: {
        collectSnapshot: () => snapshot(root),
        executeCommands: () => Promise.resolve([]),
      },
    });

    expect(artifact.bindingMethod).toBe("stage_a_native_citation");
    expect(artifact.results[0]?.registry.sources[0]?.claimsSupported).toEqual(["criterion-api"]);
    expect(result.bundle.externalClaimAssessments[0]?.status).toBe("supported");
    expect(result.bundle.gate.status).toBe("pass");
  });

  it("allows eligible cited support when the policy has no maximum source age", async () => {
    const root = makeRepository("export const run = () => client.responses.create({});\n");
    const task = makeTask(criterion(), { sourceMode: "required" });
    const config = makeConfig({ maxSourceAgeDays: null });
    const artifact = approvedArtifact(
      task,
      config,
      researchResult(source({ freshnessStatus: "unknown" })),
    );
    const result = await runEvidenceGateWorkflow({
      cwd: root,
      task,
      config,
      approvedSources: artifact,
      generatedAt: new Date(NOW),
      dependencies: {
        collectSnapshot: () => snapshot(root),
        executeCommands: () => Promise.resolve([]),
      },
    });

    expect(artifact.plans[0]?.maxSourceAgeDays).toBeNull();
    expect(result.bundle.externalClaimAssessments[0]?.freshnessWarning).toBe(false);
    expect(result.bundle.externalClaimAssessments[0]?.status).toBe("supported");
    expect(result.bundle.gate.status).toBe("pass");
  });

  it.each([
    {
      name: "citation-less",
      record: source({ citationAnnotations: [] }),
      expectedStatus: "source_error",
      metadataStatus: "partial" as const,
    },
    {
      name: "possibly stale",
      record: source({
        publishedAt: "2026-06-22T07:00:00.000Z",
        freshnessStatus: "possibly_stale",
      }),
      expectedStatus: "partially_supported",
    },
    {
      name: "unknown authority type",
      record: source({ sourceType: "unknown" }),
      expectedStatus: "source_error",
      metadataStatus: "partial" as const,
    },
  ])(
    "does not fully support a claim from $name source evidence",
    async ({ record, expectedStatus, metadataStatus }) => {
      const root = makeRepository("export const run = () => client.responses.create({});\n");
      const task = makeTask(criterion(), { sourceMode: "required" });
      const config = makeConfig();
      const research = researchResult(record);
      if (metadataStatus !== undefined) research.metadata.status = metadataStatus;
      const artifact = approvedArtifact(task, config, research);
      const result = await runEvidenceGateWorkflow({
        cwd: root,
        task,
        config,
        approvedSources: artifact,
        generatedAt: new Date(NOW),
        dependencies: {
          collectSnapshot: () => snapshot(root),
          executeCommands: () => Promise.resolve([]),
        },
      });

      expect(result.bundle.externalClaimAssessments[0]?.status).toBe(expectedStatus);
      expect(result.bundle.gate.status).not.toBe("pass");
    },
  );
});

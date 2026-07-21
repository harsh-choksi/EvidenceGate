import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  CURRENT_GATE_POLICY_VERSION,
  TaskSpecificationSchema,
  createEvidenceBundle,
  deriveCombinedStatus,
  evaluateGate,
  resolveGatePolicy,
  sha256Canonical,
  type CombinedClaimAssessment,
  type EvidenceItem,
  type ExternalClaimAssessment,
  type ExternalSourceRecord,
  type Finding,
  type InternalClaimAssessment,
  type ModelRunMetadata,
  type RepositorySnapshot,
  type TaskSpecification,
} from "@evidencegate/core";
import { analyzeSourcedAnswerRepository } from "@evidencegate/analyzers";
import { DEFAULT_OPENAI_MODEL } from "@evidencegate/config";
import {
  createOpenAIEvidenceAdjudicatorFromEnvironment,
  extractCitedNarrativeContexts,
  type AdjudicationInput,
  type AdjudicationOutput,
} from "@evidencegate/openai";
import { writeStaticReport, type StaticReportData } from "@evidencegate/report";
import { runCommand, type CommandResult } from "@evidencegate/runner";
import {
  buildOpenAIWebSearchRequest,
  createOpenAIWebSearchProviderFromEnvironment,
  parseCachedOpenAIResearchResponse,
  type SourceResearchResult,
} from "@evidencegate/source-research";
import {
  createDemoResearchCorpus,
  demoFocusedSourceSearchPlan,
  demoSourceSearchPlan,
  hasCanonicalGuideCoverage,
  hasCitationPresentationCoverage,
  supportsCitationPresentationRequirement,
  type DemoResearchCorpus,
  type DemoResearchPass,
} from "./demo-research.js";

export {
  createDemoResearchCorpus,
  demoFocusedSourceSearchPlan,
  demoSourceSearchPlan,
  hasCanonicalGuideCoverage,
  hasCitationPresentationCoverage,
  supportsCitationPresentationRequirement,
  type DemoResearchCorpus,
  type DemoResearchPass,
};

export type DemoScenario = "incomplete" | "corrected";
export type DemoSourceMode = "cached" | "live";

export interface DemoScenarioResult {
  scenario: DemoScenario;
  sourceMode: DemoSourceMode;
  gateStatus: string;
  gateSummary: string;
  gateReasonCodes: string[];
  nonPassingCriterionIds: string[];
  bundlePath: string;
  reportPath: string;
  bundleHash: string;
  commandResult: CommandResult;
  researchPassCount?: number;
  canonicalGuideCoverage?: boolean;
  adjudicationAttemptCount?: number;
}

export interface DemoRunOptions {
  model?: string;
}

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cachedAt = new Date("2026-07-18T00:00:00.000Z");
const externalCriterionIds = [
  "responses-api",
  "web-search",
  "official-domains",
  "source-metadata",
  "citation-annotations",
  "visible-citations",
  "clickable-citations",
];
const testCriterionIds = [
  "test-cited-response",
  "test-no-source",
  "test-invalid-url",
  "test-fabricated-source",
];

export const demoClaimProjections: Readonly<
  Record<string, { internalClaim: string; externalClaim: string }>
> = {
  "responses-api": {
    internalClaim: "The repository calls client.responses.create for the sourced answer.",
    externalClaim: "Official documentation describes the current Responses API interface.",
  },
  "web-search": {
    internalClaim: "The repository enables the web_search tool in its Responses request.",
    externalClaim: "Official documentation supports the web_search tool in the Responses API.",
  },
  "official-domains": {
    internalClaim:
      "The repository restricts OpenAI product searches to developers.openai.com and platform.openai.com.",
    externalClaim: "Official documentation supports allowed-domain filters for web search.",
  },
  "source-metadata": {
    internalClaim:
      "The repository requests web_search_call.action.sources and retains returned records in its source registry and result.",
    externalClaim:
      "Official documentation describes web_search_call.action.sources as the consulted-source list mechanism.",
  },
  "citation-annotations": {
    internalClaim:
      "The repository reads response output-text annotations, filters native url_citation entries, and parses their URL, title, start_index, and end_index fields.",
    externalClaim: "Official documentation describes native URL-citation annotations.",
  },
  "visible-citations": {
    internalClaim: "The UI maps every parsed citation into a visible citations region.",
    externalClaim: "Official documentation requires end-user citations to be clearly visible.",
  },
  "clickable-citations": {
    internalClaim: "The UI renders every citation as a native anchor link.",
    externalClaim: "Official documentation requires end-user citations to be clickable.",
  },
};

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

export function demoOutputDirectory(scenario: DemoScenario, sourceMode: DemoSourceMode): string {
  return sourceMode === "live"
    ? path.join(workspaceRoot, ".evidencegate", "demo", "live", scenario)
    : path.join(workspaceRoot, ".evidencegate", "demo", scenario);
}

async function collectResearch(
  mode: DemoSourceMode,
  task: TaskSpecification,
  liveModel: string,
): Promise<DemoResearchCorpus> {
  const primaryPlan = demoSourceSearchPlan(task, mode);
  if (mode === "cached") {
    const result = parseCachedOpenAIResearchResponse(
      readJson(path.join(workspaceRoot, "fixtures", "cached-openai-response.json")),
      primaryPlan,
      { retrievedAt: cachedAt, model: "gpt-5.6 (cached fixture)", strict: true },
    );
    return createDemoResearchCorpus([
      { kind: "primary", criterionIds: externalCriterionIds, plan: primaryPlan, result },
    ]);
  }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for live research.");
  const provider = await createOpenAIWebSearchProviderFromEnvironment(
    { OPENAI_API_KEY: apiKey, RUN_LIVE_OPENAI_TESTS: "true" },
    { model: liveModel, throwOnCitationIntegrityFailure: true },
  );
  const primary = await provider.research(primaryPlan, {
    approved: true,
    signal: AbortSignal.timeout(90_000),
  });
  const passes: DemoResearchPass[] = [
    { kind: "primary", criterionIds: externalCriterionIds, plan: primaryPlan, result: primary },
  ];
  if (!hasCanonicalGuideCoverage(primary)) {
    const focusedPlan = demoFocusedSourceSearchPlan(task);
    let focused: SourceResearchResult;
    try {
      focused = await provider.research(focusedPlan, {
        approved: true,
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "unknown provider failure";
      throw new Error(
        `Focused canonical-guide research failed after the primary pass lacked complete source-bound coverage: ${detail}`,
        { cause: error },
      );
    }
    passes.push({
      kind: "focused-followup",
      criterionIds: externalCriterionIds,
      plan: focusedPlan,
      result: focused,
    });
  }
  return createDemoResearchCorpus(passes);
}

function scanFixture(repositoryRoot: string, task: TaskSpecification): RepositorySnapshot {
  const changedFiles: RepositorySnapshot["changedFiles"] = [];
  const hash = createHash("sha256");

  function visit(directory: string): void {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const stats = statSync(absolute);
      if (stats.isDirectory()) visit(absolute);
      else if (stats.isFile()) {
        const relative = path.relative(repositoryRoot, absolute).replaceAll("\\", "/");
        const content = readFileSync(absolute);
        hash.update(relative).update("\0").update(content).update("\0");
        changedFiles.push({
          path: relative,
          status: "added",
          additions: content.toString("utf8").split(/\r?\n/u).length,
          deletions: 0,
          binary: content.includes(0),
        });
      }
    }
  }
  visit(repositoryRoot);
  return {
    repositoryPath: task.repositoryPath,
    baseRef: task.baseRef,
    headRef: task.headRef,
    capturedAt: cachedAt.toISOString(),
    isDirty: false,
    changedFiles,
    diffHash: hash.digest("hex"),
  };
}

async function executeFixtureTests(
  repositoryRoot: string,
  scenario: DemoScenario,
): Promise<CommandResult> {
  const testFile =
    scenario === "incomplete" ? "tests/happy-path.test.mjs" : "tests/citations.test.mjs";
  const executable = JSON.stringify(process.execPath);
  return runCommand({
    id: "fixture-tests",
    command: `${executable} --test ${testFile}`,
    cwd: repositoryRoot,
    required: true,
    timeoutSeconds: 30,
    maxOutputBytes: 50_000,
  });
}

function toCoreSources(
  research: SourceResearchResult,
  task: TaskSpecification,
): ExternalSourceRecord[] {
  return research.registry.sources.map((source) => {
    const citedContexts = extractCitedNarrativeContexts(
      research.narrative,
      source.citationAnnotations,
    );
    const sourceEvidence = citedContexts.join(" ");
    const supportPatterns: Readonly<Record<string, RegExp>> = {
      "responses-api": /responses api|responses\b|gpt-5\.6/iu,
      "web-search": /web[_ -]?search/iu,
      "official-domains": /domain filters?|allowed domains?|official documentation domains?/iu,
      "source-metadata": /source metadata|action\.sources|returned sources?/iu,
      "citation-annotations": /url citation annotations?|citation annotations?/iu,
    };
    const supports = externalCriterionIds.filter((criterionId) => {
      if (criterionId === "visible-citations") {
        return supportsCitationPresentationRequirement(sourceEvidence, "visible");
      }
      if (criterionId === "clickable-citations") {
        return supportsCitationPresentationRequirement(sourceEvidence, "clickable");
      }
      return supportPatterns[criterionId]?.test(sourceEvidence) ?? false;
    });
    return {
      sourceId: source.sourceId,
      webSearchCallId: source.webSearchCallId,
      ...(source.webSearchCallIds === undefined || source.webSearchCallIds.length <= 1
        ? {}
        : { webSearchCallIds: [...source.webSearchCallIds] }),
      url: source.url,
      normalizedUrl: source.normalizedUrl,
      title: source.title,
      domain: source.domain,
      ...(source.publisher === undefined ? {} : { publisher: source.publisher }),
      ...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt }),
      retrievedAt: source.retrievedAt,
      sourceType: source.sourceType,
      isPrimary: source.isPrimary,
      isOfficial: source.isOfficial,
      allowedByPolicy: source.allowedByPolicy,
      freshnessStatus: source.freshnessStatus,
      ...(source.contentHash === undefined ? {} : { contentHash: source.contentHash }),
      citationAnnotations: source.citationAnnotations.map((citation) => ({
        citationId: citation.citationId,
        sourceId: citation.sourceId,
        ...(citation.startIndex === undefined ? {} : { startIndex: citation.startIndex }),
        ...(citation.endIndex === undefined ? {} : { endIndex: citation.endIndex }),
        ...(citation.citedText === undefined ? {} : { citedText: citation.citedText }),
      })),
      claimsSupported: supports.filter((id) =>
        task.acceptanceCriteria.some((criterion) => criterion.criterionId === id),
      ),
      claimsContradicted: [],
      limitations: [...source.limitations],
    };
  });
}

function evidenceForAnalysis(
  analysis: ReturnType<typeof analyzeSourcedAnswerRepository>,
  commandResult: CommandResult,
): EvidenceItem[] {
  const staticEvidence: EvidenceItem[] = analysis.evidence.map((evidence) => ({
    evidenceId: evidence.evidenceId,
    criterionIds: [evidence.criterionId],
    kind: "source_file",
    status: "informational",
    summary: evidence.description,
    details: evidence.excerpt || "Pattern matched in the repository.",
    filePath: evidence.path,
    capturedAt: cachedAt.toISOString(),
  }));
  return [
    ...staticEvidence,
    {
      evidenceId: "ev_fixture_tests",
      criterionIds: [...testCriterionIds],
      kind: "test_result",
      status: commandResult.status === "passed" ? "passed" : "failed",
      summary: `Offline fixture tests ${commandResult.status}.`,
      details:
        "The Node test runner executed the fixture behavior tests. Volatile TAP timing output is intentionally omitted from the canonical bundle.",
      required: true,
      command: "node --test tests/*.test.mjs",
      capturedAt: cachedAt.toISOString(),
      metadata: { exitCode: commandResult.exitCode, status: commandResult.status },
    },
  ];
}

function buildAssessments(
  task: TaskSpecification,
  analysis: ReturnType<typeof analyzeSourcedAnswerRepository>,
  research: SourceResearchResult,
  sources: ExternalSourceRecord[],
  commandResult: CommandResult,
): {
  internal: InternalClaimAssessment[];
  external: ExternalClaimAssessment[];
  combined: CombinedClaimAssessment[];
} {
  const analysisById = new Map(
    analysis.assessments.map((assessment) => [assessment.criterionId, assessment]),
  );
  const internal: InternalClaimAssessment[] = [];
  const external: ExternalClaimAssessment[] = [];
  const combined: CombinedClaimAssessment[] = [];

  for (const criterion of task.acceptanceCriteria) {
    const analyzed = analysisById.get(criterion.criterionId);
    let internalStatus = analyzed?.status ?? "analysis_error";
    const isTest = testCriterionIds.includes(criterion.criterionId);
    if (isTest && commandResult.status !== "passed") internalStatus = "contradicted";
    const supportingEvidenceIds = [...(analyzed?.evidenceIds ?? [])];
    if (isTest && commandResult.status === "passed" && internalStatus === "verified") {
      supportingEvidenceIds.push("ev_fixture_tests");
    }
    const internalAssessment: InternalClaimAssessment = {
      criterionId: criterion.criterionId,
      normalizedClaim: criterion.text,
      status: internalStatus,
      supportingEvidenceIds,
      contradictingEvidenceIds: [],
      missingEvidence: analyzed?.missingEvidence ?? ["Deterministic repository analysis"],
      explanation: analyzed?.explanation ?? "Repository analysis did not produce a result.",
    };
    internal.push(internalAssessment);

    const needsExternal =
      criterion.evidenceDomain === "external" || criterion.evidenceDomain === "hybrid";
    const supportingSources = needsExternal
      ? sources.filter(
          (source) =>
            source.allowedByPolicy &&
            source.claimsSupported.includes(criterion.criterionId) &&
            source.sourceType === "official_documentation",
        )
      : [];
    const contradictingSources = needsExternal
      ? sources.filter(
          (source) =>
            source.allowedByPolicy && source.claimsContradicted.includes(criterion.criterionId),
        )
      : [];
    const hasCurrentSource = supportingSources.some(
      (source) => source.freshnessStatus === "current",
    );
    const onlyStaleSources =
      supportingSources.length > 0 &&
      supportingSources.every((source) => source.freshnessStatus === "stale");
    const externalStatus: ExternalClaimAssessment["status"] = !needsExternal
      ? "not_applicable"
      : !research.registry.valid
        ? "source_error"
        : supportingSources.length > 0 && contradictingSources.length > 0
          ? "conflicting_sources"
          : contradictingSources.length > 0
            ? "contradicted"
            : supportingSources.length === 0 || onlyStaleSources
              ? "insufficient_sources"
              : hasCurrentSource
                ? "supported"
                : "partially_supported";
    const missingSourceTypes =
      needsExternal && supportingSources.length === 0 ? (["official_documentation"] as const) : [];
    const freshnessWarning = supportingSources.some(
      (source) => source.freshnessStatus !== "current",
    );
    const externalAssessment: ExternalClaimAssessment = {
      criterionId: criterion.criterionId,
      normalizedClaim: criterion.text,
      status: externalStatus,
      supportingSourceIds: supportingSources.map((source) => source.sourceId),
      contradictingSourceIds: contradictingSources.map((source) => source.sourceId),
      requiredSourceTypes: needsExternal ? ["official_documentation"] : [],
      missingSourceTypes: [...missingSourceTypes],
      freshnessWarning,
      explanation: needsExternal
        ? externalStatus === "supported"
          ? "Current official OpenAI documentation cited for this criterion establishes the requirement."
          : externalStatus === "conflicting_sources"
            ? "Allowed sources support and contradict this criterion; deterministic policy requires manual review."
            : externalStatus === "contradicted"
              ? "Allowed external sources contradict this criterion."
              : externalStatus === "partially_supported"
                ? "Only undated or possibly stale official evidence supports this current requirement."
                : externalStatus === "insufficient_sources"
                  ? "No current allowed official source is bound to this criterion."
                  : "The returned source registry failed citation-integrity validation."
        : "This criterion is established from repository and execution evidence.",
      unresolvedQuestions: research.conflicts.map((conflict) => conflict.reason),
    };
    external.push(externalAssessment);

    const evidenceDomain =
      criterion.evidenceDomain === "auto" ? "hybrid" : criterion.evidenceDomain;
    const missingEvidence = [
      ...internalAssessment.missingEvidence,
      ...(needsExternal && externalStatus !== "supported"
        ? ["Valid official external source evidence"]
        : []),
    ];
    const base: CombinedClaimAssessment = {
      criterionId: criterion.criterionId,
      normalizedClaim: criterion.text,
      evidenceDomain,
      internalStatus: internalAssessment.status,
      externalStatus: externalAssessment.status,
      combinedStatus: "analysis_error",
      internalEvidenceIds: supportingEvidenceIds,
      externalSourceIds: [
        ...externalAssessment.supportingSourceIds,
        ...externalAssessment.contradictingSourceIds,
      ],
      contradictingEvidenceIds: [],
      missingEvidence,
      explanation:
        needsExternal && externalStatus === "supported" && internalStatus !== "verified"
          ? "Official sources establish the requirement, but the repository does not fully implement it."
          : internalStatus === "verified" && (!needsExternal || externalStatus === "supported")
            ? "All evidence domains required for this criterion are present."
            : internalAssessment.explanation,
      severityIfMissing:
        criterion.category === "security" || criterion.category === "api_compatibility"
          ? "high"
          : "medium",
    };
    base.combinedStatus = deriveCombinedStatus(base);
    combined.push(base);
  }
  return { internal, external, combined };
}

function severityForCriterion(
  criterion: TaskSpecification["acceptanceCriteria"][number],
): "info" | "low" | "medium" | "high" | "critical" {
  return criterion.category === "security" || criterion.category === "api_compatibility"
    ? "high"
    : "medium";
}

function buildAdjudicationInput(
  task: TaskSpecification,
  research: SourceResearchResult,
  internalEvidence: EvidenceItem[],
  sources: ExternalSourceRecord[],
  candidateCriterionIdsBySourceId: ReadonlyMap<string, readonly string[]>,
): AdjudicationInput {
  return {
    researchNarrative: research.narrative,
    criteria: task.acceptanceCriteria.map((criterion) => {
      const evidenceDomain =
        criterion.evidenceDomain === "auto" ? "hybrid" : criterion.evidenceDomain;
      return {
        criterionId: criterion.criterionId,
        normalizedClaim: criterion.text,
        ...(demoClaimProjections[criterion.criterionId] ?? {}),
        evidenceDomain,
        severityIfMissing: severityForCriterion(criterion),
        requiredSourceTypes:
          evidenceDomain === "internal" ? [] : (["official_documentation"] as const),
      };
    }),
    internalEvidence: internalEvidence.map((evidence) => ({
      evidenceId: evidence.evidenceId,
      criterionIds: [...evidence.criterionIds],
      status: evidence.status,
      summary: evidence.summary,
      ...(evidence.details === undefined ? {} : { details: evidence.details }),
    })),
    externalSources: sources.map((source) => {
      const citationExcerpts = extractCitedNarrativeContexts(
        research.narrative,
        source.citationAnnotations,
      );
      return {
        sourceId: source.sourceId,
        // Candidate scope records which approved pass returned the source. It
        // remains broader than the provisional semantic support labels that
        // Stage B independently evaluates from source-bound excerpts.
        criterionIds: [...(candidateCriterionIdsBySourceId.get(source.sourceId) ?? [])],
        url: source.normalizedUrl,
        title: source.title,
        domain: source.domain,
        sourceType: source.sourceType,
        isPrimary: source.isPrimary,
        isOfficial: source.isOfficial,
        allowedByPolicy: source.allowedByPolicy,
        freshnessStatus: source.freshnessStatus,
        claimsSupported: [...source.claimsSupported],
        claimsContradicted: [...source.claimsContradicted],
        limitations: [...source.limitations],
        ...(citationExcerpts.length === 0 ? {} : { citationExcerpts }),
      };
    }),
  };
}

function normalizeAdjudicationOutput(
  output: AdjudicationOutput,
  task: TaskSpecification,
): {
  internal: InternalClaimAssessment[];
  external: ExternalClaimAssessment[];
  combined: CombinedClaimAssessment[];
} {
  const claims = new Map(
    task.acceptanceCriteria.map((criterion) => [criterion.criterionId, criterion.text]),
  );
  const internal: InternalClaimAssessment[] = output.internalClaimAssessments.map((assessment) => ({
    ...assessment,
    normalizedClaim: claims.get(assessment.criterionId) ?? assessment.normalizedClaim,
  }));
  const external: ExternalClaimAssessment[] = output.externalClaimAssessments.map((assessment) => ({
    ...assessment,
    normalizedClaim: claims.get(assessment.criterionId) ?? assessment.normalizedClaim,
  }));
  const combined: CombinedClaimAssessment[] = output.combinedClaimAssessments.map((assessment) => {
    const candidate: CombinedClaimAssessment = {
      ...assessment,
      normalizedClaim: claims.get(assessment.criterionId) ?? assessment.normalizedClaim,
    };
    return { ...candidate, combinedStatus: deriveCombinedStatus(candidate) };
  });
  return { internal, external, combined };
}

async function adjudicateEvidence(
  scenario: DemoScenario,
  task: TaskSpecification,
  research: SourceResearchResult,
  internalEvidence: EvidenceItem[],
  sources: ExternalSourceRecord[],
  candidateCriterionIdsBySourceId: ReadonlyMap<string, readonly string[]>,
  model: string,
): Promise<{
  assessments: {
    internal: InternalClaimAssessment[];
    external: ExternalClaimAssessment[];
    combined: CombinedClaimAssessment[];
  };
  modelRuns: ModelRunMetadata[];
}> {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for live evidence adjudication.");

  const input = buildAdjudicationInput(
    task,
    research,
    internalEvidence,
    sources,
    candidateCriterionIdsBySourceId,
  );
  const adjudicator = await createOpenAIEvidenceAdjudicatorFromEnvironment(
    { OPENAI_API_KEY: apiKey, RUN_LIVE_OPENAI_ADJUDICATION: "true" },
    { model, maxValidationRetries: 1 },
  );
  const result = await adjudicator.adjudicateDetailed(input, {
    signal: AbortSignal.timeout(90_000),
  });
  return {
    assessments: normalizeAdjudicationOutput(result.output, task),
    modelRuns: result.attempts.map((attempt) => ({
      modelRunId: `model-run-${scenario}-adjudication-attempt-${attempt.attempt}`,
      criterionIds: task.acceptanceCriteria.map((criterion) => criterion.criterionId),
      purpose: "evidence_adjudication",
      model,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      status: attempt.status === "completed" ? "completed" : "failed",
      ...(attempt.responseId === undefined ? {} : { responseId: attempt.responseId }),
      inputHash: attempt.inputHash,
      toolCallIds: [],
      ...(attempt.status === "validation_failed"
        ? {
            error: `Local validation rejected ${attempt.validationIssueCount} structured-output issue(s).`,
          }
        : {}),
    })),
  };
}

function buildFindings(assessments: CombinedClaimAssessment[]): Finding[] {
  return assessments
    .filter((assessment) => assessment.combinedStatus !== "verified")
    .map((assessment) => ({
      findingId: `finding-${assessment.criterionId}`,
      criterionIds: [assessment.criterionId],
      severity: assessment.severityIfMissing,
      category: "missing_evidence",
      title: `Required criterion is ${assessment.combinedStatus.replaceAll("_", " ")}`,
      description: assessment.explanation,
      evidenceIds: assessment.internalEvidenceIds,
      sourceIds: assessment.externalSourceIds,
      remediation: assessment.missingEvidence.join("; ") || "Review the criterion evidence.",
    }));
}

function displayGateStatus(status: string): string {
  return status
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function buildDemoScenario(
  scenario: DemoScenario,
  sourceMode: DemoSourceMode,
  researchOverride?: SourceResearchResult | DemoResearchCorpus,
  options: DemoRunOptions = {},
): Promise<DemoScenarioResult> {
  const task = TaskSpecificationSchema.parse(
    readJson(path.join(workspaceRoot, "fixtures", "demo-task.json")),
  );
  const corpus =
    researchOverride === undefined
      ? await collectResearch(sourceMode, task, options.model ?? DEFAULT_OPENAI_MODEL)
      : "merged" in researchOverride
        ? researchOverride
        : createDemoResearchCorpus([
            {
              kind: "primary",
              criterionIds: externalCriterionIds,
              plan: demoSourceSearchPlan(task, sourceMode),
              result: researchOverride,
            },
          ]);
  const research = corpus.merged;
  const repositoryRoot = path.join(workspaceRoot, "fixtures", `${scenario}-patch`);
  const analysis = analyzeSourcedAnswerRepository(repositoryRoot, task.acceptanceCriteria);
  const commandResult = await executeFixtureTests(repositoryRoot, scenario);
  const repository = scanFixture(repositoryRoot, task);
  const sources = toCoreSources(research, task);
  const internalEvidence = evidenceForAnalysis(analysis, commandResult);
  const deterministicAssessments = buildAssessments(
    task,
    analysis,
    research,
    sources,
    commandResult,
  );
  const adjudication =
    sourceMode === "live"
      ? await adjudicateEvidence(
          scenario,
          task,
          research,
          internalEvidence,
          sources,
          corpus.candidateCriterionIdsBySourceId,
          research.metadata.model,
        )
      : undefined;
  const assessments = adjudication?.assessments ?? deterministicAssessments;
  const findings = buildFindings(assessments.combined);
  const gatePolicy = resolveGatePolicy();
  const gate = evaluateGate(
    {
      task,
      combinedClaimAssessments: assessments.combined,
      internalEvidence,
      findings,
    },
    gatePolicy,
  );
  const generatedAt = sourceMode === "cached" ? cachedAt.toISOString() : new Date().toISOString();
  const researchRun = {
    ...research.metadata,
    criterionIds: [...externalCriterionIds],
  };
  const bundle = createEvidenceBundle({
    schemaVersion: 1,
    bundleId: `bundle-sourced-answer-${scenario}-${sourceMode}`,
    generatedAt,
    toolVersion: "0.1.0",
    task,
    repository,
    internalEvidence,
    externalSources: sources,
    internalClaimAssessments: assessments.internal,
    externalClaimAssessments: assessments.external,
    combinedClaimAssessments: assessments.combined,
    findings,
    gate,
    researchRuns: [researchRun],
    modelRuns:
      sourceMode === "live"
        ? [
            ...corpus.passes.map((pass, index) => ({
              modelRunId: `model-run-${scenario}-research-pass-${index + 1}`,
              criterionIds: [...pass.criterionIds],
              purpose: "external_research" as const,
              model: pass.result.metadata.model,
              startedAt: pass.result.metadata.startedAt,
              completedAt: pass.result.metadata.completedAt,
              status: pass.result.metadata.status,
              ...(pass.result.rawResponseId === undefined
                ? {}
                : { responseId: pass.result.rawResponseId }),
              inputHash: sha256Canonical(
                buildOpenAIWebSearchRequest(pass.plan, pass.result.metadata.model),
              ),
              toolCallIds: [...pass.result.metadata.webSearchCallIds],
            })),
            ...adjudication!.modelRuns,
          ]
        : [],
    sourcePolicyVersion: sourceMode === "live" ? "official-only-no-max-age-v1" : "official-only-v1",
    gatePolicyVersion: CURRENT_GATE_POLICY_VERSION,
    gatePolicy,
  });

  const outputDirectory = demoOutputDirectory(scenario, sourceMode);
  mkdirSync(outputDirectory, { recursive: true });
  const bundlePath = path.join(outputDirectory, "evidence-bundle.json");
  writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  const evidenceById = new Map(internalEvidence.map((evidence) => [evidence.evidenceId, evidence]));
  const reportData: StaticReportData = {
    productName: process.env["EVIDENCEGATE_PRODUCT_NAME"] ?? "EvidenceGate",
    tagline:
      process.env["EVIDENCEGATE_TAGLINE"] ??
      "Verify AI-generated code against its requirements and the authoritative sources behind them.",
    scenarioLabel: `${scenario} patch`,
    sourceModeLabel:
      sourceMode === "live" ? "live OpenAI web search" : "cached validated source fixture",
    generatedAt,
    gateStatus: displayGateStatus(gate.status),
    gateExplanation: gate.summary,
    bundleHash: bundle.bundleHash,
    taskTitle: task.title,
    model: sourceMode === "live" ? research.metadata.model : "gpt-5.6 · cached response",
    sourcePolicy:
      sourceMode === "live"
        ? "official_only · developers.openai.com / platform.openai.com · no maximum source age"
        : "official_only · developers.openai.com / platform.openai.com · maximum age 30 days",
    commandSummary: [
      { name: "fixture tests", status: commandResult.status, durationMs: commandResult.durationMs },
    ],
    criteria: assessments.combined.map((assessment) => {
      const criterion = task.acceptanceCriteria.find(
        (candidate) => candidate.criterionId === assessment.criterionId,
      )!;
      return {
        criterionId: assessment.criterionId,
        text: criterion.text,
        required: criterion.required,
        evidenceDomain: assessment.evidenceDomain,
        internalStatus: assessment.internalStatus,
        externalStatus: assessment.externalStatus,
        combinedStatus: assessment.combinedStatus,
        internalEvidence: assessment.internalEvidenceIds
          .map((id) => evidenceById.get(id))
          .filter((item): item is EvidenceItem => item !== undefined)
          .map((item) => ({
            path: item.filePath ?? item.command ?? item.kind,
            description: item.summary,
          })),
        sourceIds: assessment.externalSourceIds,
        missingEvidence: assessment.missingEvidence,
        explanation: assessment.explanation,
        severity: assessment.severityIfMissing,
      };
    }),
    sources: sources.map((source) => ({
      sourceId: source.sourceId,
      title: source.title,
      url: source.normalizedUrl,
      domain: source.domain,
      ...(source.publisher === undefined ? {} : { publisher: source.publisher }),
      sourceType: source.sourceType,
      isPrimary: source.isPrimary,
      isOfficial: source.isOfficial,
      ...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt }),
      retrievedAt: source.retrievedAt,
      freshnessStatus: source.freshnessStatus,
      claimsSupported: source.claimsSupported,
      claimsContradicted: source.claimsContradicted,
      limitations: source.limitations,
      citationCount: source.citationAnnotations.length,
      citationAnnotations: source.citationAnnotations.map((citation) => ({
        citationId: citation.citationId,
        sourceId: citation.sourceId,
        ...(citation.startIndex === undefined ? {} : { startIndex: citation.startIndex }),
        ...(citation.endIndex === undefined ? {} : { endIndex: citation.endIndex }),
        ...(citation.citedText === undefined ? {} : { citedText: citation.citedText }),
      })),
    })),
    findings: findings.map((finding) => ({
      severity: finding.severity,
      title: finding.title,
      description: finding.description,
      ...(finding.criterionIds[0] === undefined ? {} : { criterionId: finding.criterionIds[0] }),
    })),
    researchNarrative: research.narrative,
    searchQueries: research.metadata.queries,
  };
  const reportPath = writeStaticReport(path.join(outputDirectory, "report.html"), reportData);
  return {
    scenario,
    sourceMode,
    gateStatus: gate.status,
    gateSummary: gate.summary,
    gateReasonCodes: [...gate.reasonCodes],
    nonPassingCriterionIds: gate.criterionResults
      .filter((result) => result.disposition !== "pass")
      .map((result) => result.criterionId),
    bundlePath,
    reportPath,
    bundleHash: bundle.bundleHash,
    commandResult,
    researchPassCount: corpus.passes.length,
    canonicalGuideCoverage: hasCanonicalGuideCoverage(research),
    ...(adjudication === undefined
      ? {}
      : { adjudicationAttemptCount: adjudication.modelRuns.length }),
  };
}

export async function runFailToPassDemo(
  sourceMode: DemoSourceMode,
  options: DemoRunOptions = {},
): Promise<DemoScenarioResult[]> {
  const task = TaskSpecificationSchema.parse(
    readJson(path.join(workspaceRoot, "fixtures", "demo-task.json")),
  );
  const corpus = await collectResearch(sourceMode, task, options.model ?? DEFAULT_OPENAI_MODEL);
  const incomplete = await buildDemoScenario("incomplete", sourceMode, corpus);
  const corrected = await buildDemoScenario("corrected", sourceMode, corpus);
  if (incomplete.gateStatus !== "fail") {
    throw new Error(demoInvariantErrorMessage(incomplete, "fail"));
  }
  if (corrected.gateStatus !== "pass") {
    throw new Error(demoInvariantErrorMessage(corrected, "pass"));
  }
  return [incomplete, corrected];
}

export function demoInvariantErrorMessage(
  result: DemoScenarioResult,
  expectedStatus: "fail" | "pass",
): string {
  const criteria =
    result.nonPassingCriterionIds.length === 0 ? "none" : result.nonPassingCriterionIds.join(", ");
  const reasons = result.gateReasonCodes.length === 0 ? "none" : result.gateReasonCodes.join(", ");
  return [
    `Demo invariant failed: ${result.scenario} patch produced ${result.gateStatus}; expected ${expectedStatus}.`,
    result.gateSummary,
    `Non-passing criteria: ${criteria}.`,
    `Gate reasons: ${reasons}.`,
    ...(result.canonicalGuideCoverage === false
      ? [
          `Single-guide umbrella coverage (non-gating) remained incomplete after ${result.researchPassCount ?? 0} research pass(es).`,
        ]
      : []),
    `Bundle: ${result.bundlePath}`,
    `Report: ${result.reportPath}`,
  ].join(" ");
}

export function workspacePath(...segments: string[]): string {
  return path.join(workspaceRoot, ...segments);
}

export function demoOutputsExist(): boolean {
  return ["incomplete", "corrected"].every((scenario) =>
    existsSync(path.join(workspaceRoot, ".evidencegate", "demo", scenario, "evidence-bundle.json")),
  );
}

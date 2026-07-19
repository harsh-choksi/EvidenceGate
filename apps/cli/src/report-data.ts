import type { EvidenceBundle } from "@evidencegate/core";
import type { StaticReportData } from "@evidencegate/report";

const RETAINED_NARRATIVE_NOTICE =
  "The full model-written research narrative was not retained in this evidence bundle. Validated native citation counts and source records remain inspectable below.";

export function reportDataFromBundle(bundle: EvidenceBundle): StaticReportData {
  const evidenceById = new Map(bundle.internalEvidence.map((item) => [item.evidenceId, item]));
  const criteriaById = new Map(
    bundle.task.acceptanceCriteria.map((item) => [item.criterionId, item]),
  );

  return {
    productName: process.env["EVIDENCEGATE_PRODUCT_NAME"] ?? "EvidenceGate",
    tagline:
      process.env["EVIDENCEGATE_TAGLINE"] ??
      "Verify AI-generated code against its requirements and the authoritative sources behind them.",
    scenarioLabel: "evidence bundle",
    sourceModeLabel:
      bundle.researchRuns.length === 0
        ? "no external research recorded"
        : bundle.researchRuns.some((run) => /cached/iu.test(run.model))
          ? "cached research fixture"
          : "live OpenAI web search evidence",
    generatedAt: bundle.generatedAt,
    gateStatus: bundle.gate.status
      .replaceAll("_", " ")
      .replace(/\b\w/gu, (letter) => letter.toUpperCase()),
    gateExplanation: bundle.gate.summary,
    bundleHash: bundle.bundleHash,
    taskTitle: bundle.task.title,
    model: bundle.modelRuns[0]?.model ?? bundle.researchRuns[0]?.model ?? "deterministic only",
    sourcePolicy: bundle.sourcePolicyVersion,
    commandSummary: bundle.internalEvidence
      .filter((item) => item.command !== undefined)
      .map((item) => ({
        name: item.kind,
        status: item.status,
        durationMs:
          typeof item.metadata?.["durationMs"] === "number" ? item.metadata["durationMs"] : 0,
      })),
    criteria: bundle.combinedClaimAssessments.map((assessment) => ({
      criterionId: assessment.criterionId,
      text: criteriaById.get(assessment.criterionId)?.text ?? assessment.normalizedClaim,
      required: criteriaById.get(assessment.criterionId)?.required ?? true,
      evidenceDomain: assessment.evidenceDomain,
      internalStatus: assessment.internalStatus,
      externalStatus: assessment.externalStatus,
      combinedStatus: assessment.combinedStatus,
      internalEvidence: assessment.internalEvidenceIds
        .map((id) => evidenceById.get(id))
        .filter((item) => item !== undefined)
        .map((item) => ({
          path: item.filePath ?? item.command ?? item.kind,
          description: item.summary,
        })),
      sourceIds: assessment.externalSourceIds,
      missingEvidence: assessment.missingEvidence,
      explanation: assessment.explanation,
      severity: assessment.severityIfMissing,
    })),
    sources: bundle.externalSources.map((source) => ({
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
      citationAnnotations: [],
    })),
    findings: bundle.findings.map((finding) => ({
      severity: finding.severity,
      title: finding.title,
      description: finding.description,
      ...(finding.criterionIds[0] === undefined ? {} : { criterionId: finding.criterionIds[0] }),
    })),
    researchNarrative: RETAINED_NARRATIVE_NOTICE,
    searchQueries: bundle.researchRuns.flatMap((run) => run.queries),
  };
}

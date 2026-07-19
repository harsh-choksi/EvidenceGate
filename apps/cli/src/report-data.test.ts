import { describe, expect, it } from "vitest";

import type { EvidenceBundle } from "@evidencegate/core";

import { reportDataFromBundle } from "./report-data.js";

const NOW = "2026-07-18T12:00:00.000Z";

describe("bundle report data", () => {
  it("preserves source and native citation counts without inventing a research narrative", () => {
    const rawMarkdownCitation =
      "[Official documentation](https://developers.openai.com/api/docs/guides/tools-web-search)";
    const bundle = {
      schemaVersion: 1,
      bundleId: "bundle-report-test",
      generatedAt: NOW,
      toolVersion: "0.1.0",
      task: {
        schemaVersion: 1,
        taskId: "task-report-test",
        title: "Report retained evidence honestly",
        problemStatement: "Render an existing evidence bundle.",
        acceptanceCriteria: [],
        baseRef: "main",
        headRef: "HEAD",
        repositoryPath: ".",
        createdAt: NOW,
        sourceMode: "required",
      },
      repository: {
        repositoryPath: ".",
        baseRef: "main",
        headRef: "HEAD",
        capturedAt: NOW,
        isDirty: false,
        changedFiles: [],
      },
      internalEvidence: [],
      externalSources: [
        {
          sourceId: "source-report-test",
          webSearchCallId: "search-report-test",
          url: "https://developers.openai.com/api/docs/guides/tools-web-search",
          normalizedUrl: "https://developers.openai.com/api/docs/guides/tools-web-search",
          title: "Web search guide",
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
              citationId: "citation-report-1",
              sourceId: "source-report-test",
              startIndex: 0,
              endIndex: rawMarkdownCitation.length,
              citedText: rawMarkdownCitation,
            },
            {
              citationId: "citation-report-2",
              sourceId: "source-report-test",
              startIndex: rawMarkdownCitation.length + 1,
              endIndex: rawMarkdownCitation.length + 12,
              citedText: "Second fact",
            },
          ],
          claimsSupported: [],
          claimsContradicted: [],
          limitations: [],
        },
      ],
      internalClaimAssessments: [],
      externalClaimAssessments: [],
      combinedClaimAssessments: [],
      findings: [],
      gate: {
        status: "pass",
        summary: "pass: no required criteria",
        criterionResults: [],
        failedCriterionIds: [],
        warningCriterionIds: [],
        manualReviewCriterionIds: [],
        analysisErrorCriterionIds: [],
        sourceErrorCriterionIds: [],
        reasonCodes: [],
      },
      researchRuns: [
        {
          researchRunId: "research-report-test",
          criterionIds: [],
          model: "gpt-5.6",
          webSearchCallIds: ["search-report-test"],
          queries: ["OpenAI web search citation annotations"],
          allowedDomains: ["developers.openai.com"],
          blockedDomains: [],
          startedAt: NOW,
          completedAt: NOW,
          sourceCount: 1,
          citationCount: 2,
          status: "completed",
        },
      ],
      modelRuns: [],
      sourcePolicyVersion: "1",
      gatePolicyVersion: "deterministic-v1",
      bundleHash: "0".repeat(64),
    } satisfies EvidenceBundle;

    const report = reportDataFromBundle(bundle);

    expect(report.researchNarrative).toContain(
      "full model-written research narrative was not retained",
    );
    expect(report.researchNarrative).not.toContain(rawMarkdownCitation);
    expect(report.sourceModeLabel).toBe("live OpenAI web search evidence");
    expect(report.sources).toHaveLength(1);
    expect(report.sources[0]).toMatchObject({
      sourceId: "source-report-test",
      citationCount: 2,
      citationAnnotations: [],
    });
  });
});

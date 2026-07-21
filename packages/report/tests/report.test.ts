import { describe, expect, it } from "vitest";
import {
  renderStaticReport,
  type ReportCitationAnnotation,
  type ReportSource,
  type StaticReportData,
} from "../src/index.js";

const firstClaim = "Official docs describe the requirement.";
const secondClaim = "A second source confirms it.";
const narrative = `${firstClaim} ${secondClaim}`;

function buildSource(overrides: Partial<ReportSource> = {}): ReportSource {
  const source: ReportSource = {
    sourceId: "src_1",
    title: "Official docs",
    url: "https://developers.openai.com/docs",
    domain: "developers.openai.com",
    publisher: "OpenAI",
    sourceType: "official_documentation",
    isPrimary: true,
    isOfficial: true,
    publishedAt: "2026-07-17T00:00:00.000Z",
    retrievedAt: "2026-07-18T00:00:00.000Z",
    freshnessStatus: "current",
    citationAnnotations: [
      {
        citationId: "citation_1",
        sourceId: "src_1",
        startIndex: 0,
        endIndex: firstClaim.length,
        citedText: firstClaim,
      },
    ],
    citationCount: 1,
    claimsSupported: ["criterion_supported"],
    claimsContradicted: ["criterion_contradicted"],
    limitations: ["The documentation may change."],
    ...overrides,
  };
  source.citationCount = overrides.citationCount ?? source.citationAnnotations.length;
  return source;
}

function buildData(overrides: Partial<StaticReportData> = {}): StaticReportData {
  return {
    productName: "EvidenceGate",
    tagline: "Inspect the evidence.",
    scenarioLabel: "test",
    sourceModeLabel: "cached",
    generatedAt: "2026-07-18T00:00:00.000Z",
    gateStatus: "Fail",
    gateExplanation: "Missing evidence",
    bundleHash: "abc",
    taskTitle: "Task",
    model: "gpt-5.6",
    sourcePolicy: "official_only",
    commandSummary: [],
    criteria: [],
    sources: [buildSource()],
    findings: [],
    researchNarrative: narrative,
    searchQueries: [],
    ...overrides,
  };
}

function countInlineCitations(html: string): number {
  return (html.match(/class="inline-citation"/gu) ?? []).length;
}

describe("static report", () => {
  it("binds native annotation ranges to visible clickable inline citations", () => {
    const html = renderStaticReport(buildData());

    expect(html).toContain(`${firstClaim}<a class="inline-citation"`);
    expect(html).toContain('data-citation-id="citation_1"');
    expect(html).toContain('data-source-id="src_1"');
    expect(html).toContain('href="https://developers.openai.com/docs"');
    expect(html).toContain('<span class="inline-citation__label">[Official docs]</span>');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(countInlineCitations(html)).toBe(1);
  });

  it("renders multiple non-overlapping annotations beside their claims", () => {
    const secondStart = firstClaim.length + 1;
    const secondSource = buildSource({
      sourceId: "src_2",
      title: "Second standard",
      url: "https://example.org/standard",
      domain: "example.org",
      publisher: "Standards Publisher",
      isOfficial: false,
      citationAnnotations: [
        {
          citationId: "citation_2",
          sourceId: "src_2",
          startIndex: secondStart,
          endIndex: narrative.length,
          citedText: secondClaim,
        },
      ],
    });
    const html = renderStaticReport(buildData({ sources: [buildSource(), secondSource] }));

    expect(countInlineCitations(html)).toBe(2);
    expect(html).toContain("[Official docs]");
    expect(html).toContain("[Second standard]");
    expect(html).not.toContain("Citation integrity warning.");
  });

  it("escapes narrative, labels, and source metadata as untrusted text", () => {
    const hostileNarrative = '<script>alert("narrative")</script> & accepted.';
    const hostileSource = buildSource({
      title: '<img src=x onerror="alert(1)">',
      publisher: "Publisher <script>bad()</script>",
      sourceType: "official_<documentation>",
      citationAnnotations: [
        {
          citationId: "citation_hostile",
          sourceId: "src_1",
          startIndex: 0,
          endIndex: hostileNarrative.length,
          citedText: hostileNarrative,
        },
      ],
      claimsSupported: ["<b>supported</b>"],
      claimsContradicted: ['<img src=x onerror="bad()">'],
      limitations: ["<script>limitation()</script>"],
    });
    const html = renderStaticReport(
      buildData({ researchNarrative: hostileNarrative, sources: [hostileSource] }),
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain(
      "&lt;script&gt;alert(&quot;narrative&quot;)&lt;/script&gt; &amp; accepted.",
    );
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;b&gt;supported&lt;/b&gt;");
    expect(countInlineCitations(html)).toBe(1);
  });

  it("keeps model-authored verdict language subordinate to the deterministic gate", () => {
    const modelNarrative = "## EvidenceGate verdict: **PASS**";
    const html = renderStaticReport(
      buildData({
        gateStatus: "Fail",
        gateExplanation: "fail: required repository evidence is missing",
        researchNarrative: modelNarrative,
        sources: [buildSource({ citationAnnotations: [] })],
      }),
    );

    expect(html).toContain("External research narrative — not the gate decision.");
    expect(html).toContain(
      "Only the deterministic Overall gate above controls the release result.",
    );
    expect(html).toContain("<strong>Fail</strong>");
    expect(html).toContain(modelNarrative);
  });

  it("rejects a fabricated source ID in an otherwise valid annotation", () => {
    const source = buildSource({
      citationAnnotations: [
        {
          citationId: "citation_fabricated",
          sourceId: "src_fabricated",
          startIndex: 0,
          endIndex: firstClaim.length,
          citedText: firstClaim,
        },
      ],
    });
    const html = renderStaticReport(buildData({ sources: [source] }));

    expect(countInlineCitations(html)).toBe(0);
    expect(html).not.toContain('data-source-id="src_fabricated"');
    expect(html).toContain("1 annotation was omitted");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://example.com/file",
  ])("never renders unsafe source scheme %s in cards or inline citations", (url) => {
    const html = renderStaticReport(buildData({ sources: [buildSource({ url })] }));

    expect(html).not.toContain(`href="${url}`);
    expect(html).toContain("Official docs <small>URL rejected");
    expect(html).toContain("URL rejected by report safety policy");
    expect(countInlineCitations(html)).toBe(0);
    expect(html).toContain("Citation integrity warning.");
  });

  it("rejects source URLs containing credentials", () => {
    const html = renderStaticReport(
      buildData({
        sources: [buildSource({ url: "https://user:secret@example.com/docs" })],
      }),
    );

    expect(html).not.toContain('href="https://user:secret@example.com/docs"');
    expect(html).toContain("URL rejected");
    expect(countInlineCitations(html)).toBe(0);
  });

  it("rejects source URLs containing credentials", () => {
    const html = renderStaticReport(
      buildData({
        sources: [buildSource({ url: "https://user:secret@example.com/docs" })],
      }),
    );

    expect(html).not.toContain('href="https://user:secret@example.com/docs"');
    expect(html).toContain("URL rejected");
    expect(countInlineCitations(html)).toBe(0);
  });

  it("omits invalid, partial, reversed, fractional, and oversized ranges", () => {
    const invalidAnnotations: ReportCitationAnnotation[] = [
      { citationId: "negative", sourceId: "src_1", startIndex: -1, endIndex: 4 },
      { citationId: "partial", sourceId: "src_1", startIndex: 0 },
      { citationId: "reversed", sourceId: "src_1", startIndex: 8, endIndex: 3 },
      { citationId: "fractional", sourceId: "src_1", startIndex: 0.5, endIndex: 3 },
      {
        citationId: "oversized",
        sourceId: "src_1",
        startIndex: 0,
        endIndex: narrative.length + 1,
      },
      {
        citationId: "valid",
        sourceId: "src_1",
        startIndex: 0,
        endIndex: firstClaim.length,
        citedText: firstClaim,
      },
    ];
    const html = renderStaticReport(
      buildData({ sources: [buildSource({ citationAnnotations: invalidAnnotations })] }),
    );

    expect(countInlineCitations(html)).toBe(1);
    expect(html).toContain('data-citation-id="valid"');
    expect(html).toContain("5 annotations were omitted");
  });

  it("rejects every annotation involved in an overlap while keeping disjoint citations", () => {
    const secondStart = firstClaim.length + 1;
    const annotations: ReportCitationAnnotation[] = [
      { citationId: "overlap_a", sourceId: "src_1", startIndex: 0, endIndex: 20 },
      { citationId: "overlap_b", sourceId: "src_1", startIndex: 10, endIndex: 25 },
      {
        citationId: "disjoint",
        sourceId: "src_1",
        startIndex: secondStart,
        endIndex: narrative.length,
        citedText: secondClaim,
      },
    ];
    const html = renderStaticReport(
      buildData({ sources: [buildSource({ citationAnnotations: annotations })] }),
    );

    expect(countInlineCitations(html)).toBe(1);
    expect(html).toContain('data-citation-id="disjoint"');
    expect(html).not.toContain('data-citation-id="overlap_a"');
    expect(html).not.toContain('data-citation-id="overlap_b"');
    expect(html).toContain("2 annotations were omitted");
  });

  it("shows complete judge-facing source metadata", () => {
    const html = renderStaticReport(buildData());

    expect(html).toContain("Publisher</dt><dd>OpenAI");
    expect(html).toContain("Domain</dt><dd>developers.openai.com");
    expect(html).toContain("Source type</dt><dd>official documentation");
    expect(html).toContain("Authority</dt><dd>Official · Primary");
    expect(html).toContain("Native citations</dt><dd>1");
    expect(html).toContain("Published</dt><dd>2026-07-17T00:00:00.000Z");
    expect(html).toContain("Retrieved</dt><dd>2026-07-18T00:00:00.000Z");
    expect(html).toContain("Supported claims</h4>");
    expect(html).toContain("criterion_supported");
    expect(html).toContain("Contradicted claims</h4>");
    expect(html).toContain("criterion_contradicted");
    expect(html).toContain("Limitations</h4>");
    expect(html).toContain("The documentation may change.");
    expect(html).toContain("status--current");
  });

  it("keeps source titles and full URLs visible in print output", () => {
    const html = renderStaticReport(buildData());

    expect(html).toContain("@media print");
    expect(html).toContain(".source-title,.source-url{display:block!important}");
    expect(html).toContain(".inline-citation__url{display:inline");
    expect(html).toContain('<h3 class="source-title"><a href="https://developers.openai.com/docs"');
    expect(html).toContain(
      '<a class="source-url" href="https://developers.openai.com/docs" target="_blank" rel="noopener noreferrer">https://developers.openai.com/docs</a>',
    );
    expect(html).toContain(" — https://developers.openai.com/docs</span>");
    expect(html).toContain("@page{size:letter;margin:.5in}");
    expect(html).toContain(".source-grid{grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(html).toContain(".section__head{break-inside:avoid-page");
    expect(html).toContain(".decision{background:white;color:var(--ink)");
    expect(html).toContain(".footer{break-before:avoid-page");
  });

  it("uses gate-aware hero copy and removes duplicate internal evidence rows", () => {
    const repeatedEvidence = {
      path: "src/server.ts",
      description: "The same verified evidence record.",
    };
    const criterion = {
      criterionId: "criterion_1",
      text: "Verify one behavior.",
      required: true,
      evidenceDomain: "internal" as const,
      internalStatus: "verified",
      externalStatus: "not_applicable",
      combinedStatus: "verified",
      internalEvidence: [repeatedEvidence, { ...repeatedEvidence }],
      sourceIds: [],
      missingEvidence: [],
      explanation: "Repository evidence verifies the behavior.",
      severity: "high",
    };
    const passHtml = renderStaticReport(buildData({ gateStatus: "Pass", criteria: [criterion] }));
    const failHtml = renderStaticReport(buildData({ gateStatus: "Fail" }));

    expect(passHtml).toContain("<h1>Code and sources agree.</h1>");
    expect(failHtml).toContain("<h1>Code says one thing.<br />Sources say another.</h1>");
    expect(passHtml).toContain("<title>EvidenceGate · test · Pass</title>");
    expect(failHtml).toContain("<title>EvidenceGate · test · Fail</title>");
    expect(passHtml.match(/The same verified evidence record\./gu)).toHaveLength(1);
  });

  it("counts every required non-passing criterion in the summary metric", () => {
    const criterion = {
      criterionId: "criterion_1",
      text: "Verify one behavior.",
      required: true,
      evidenceDomain: "internal" as const,
      internalStatus: "partially_verified",
      externalStatus: "not_applicable",
      combinedStatus: "partially_verified",
      internalEvidence: [],
      sourceIds: [],
      missingEvidence: ["Complete repository evidence."],
      explanation: "The behavior is only partially verified.",
      severity: "high",
    };
    const optionalUnsupported = {
      ...criterion,
      criterionId: "criterion_optional",
      required: false,
      internalStatus: "unsupported",
      combinedStatus: "unsupported",
    };
    const html = renderStaticReport(
      buildData({ criteria: [criterion, optionalUnsupported], gateStatus: "Fail" }),
    );

    expect(html).toContain("1 required non-passing");
    expect(html).not.toContain("2 required non-passing");
  });

  it("distinguishes unsupported authority evidence from an inapplicable lane", () => {
    const baseCriterion = {
      criterionId: "criterion_1",
      text: "Verify one behavior.",
      required: true,
      internalStatus: "verified" as const,
      internalEvidence: [],
      sourceIds: [],
      missingEvidence: [],
      explanation: "Evidence status is shown accurately.",
      severity: "medium" as const,
    };
    const html = renderStaticReport(
      buildData({
        criteria: [
          {
            ...baseCriterion,
            evidenceDomain: "hybrid" as const,
            externalStatus: "not_supported" as const,
            combinedStatus: "unsupported" as const,
          },
          {
            ...baseCriterion,
            criterionId: "criterion_2",
            evidenceDomain: "internal" as const,
            externalStatus: "not_applicable" as const,
            combinedStatus: "verified" as const,
          },
        ],
      }),
    );

    expect(html).toContain("No supporting authority source was cited");
    expect(html).toContain("Authority evidence is not applicable to this criterion");
    expect(html).not.toContain("No external source required or available");
  });
});

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeSourcedAnswerRepository } from "../src/index.js";

describe("sourced answer analyzer", () => {
  it("distinguishes an API call from a web-search configuration", () => {
    const root = mkdtempSync(path.join(tmpdir(), "evidencegate-analyzer-"));
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src", "server.ts"), "client.responses.create({ input: 'hi' });");
    const criteria = [
      { criterionId: "responses-api", text: "Responses API", required: true },
      { criterionId: "web-search", text: "web search", required: true },
    ];
    const result = analyzeSourcedAnswerRepository(root, criteria);
    expect(result.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterionId: "responses-api", status: "verified" }),
        expect.objectContaining({ criterionId: "web-search", status: "unsupported" }),
      ]),
    );
  });

  it("requires exact documentation domains, source retention, and actual citation rendering", () => {
    const root = mkdtempSync(path.join(tmpdir(), "evidencegate-analyzer-complete-"));
    mkdirSync(path.join(root, "src"));
    writeFileSync(
      path.join(root, "src", "server.ts"),
      `const OFFICIAL_OPENAI_DOMAINS = ["developers.openai.com", "platform.openai.com"];
       const response = await client.responses.create({
         tools: [{ type: "web_search", filters: { allowed_domains: OFFICIAL_OPENAI_DOMAINS } }],
         include: ["web_search_call.action.sources"],
       });
       const sourceRegistry = buildSourceRegistry(returnedSources);
       return { sources: [...sourceRegistry.values()] };`,
    );
    writeFileSync(
      path.join(root, "src", "Citations.tsx"),
      `<aside aria-label="Citations"><h2>Citations</h2><ol>{citations.map((citation) => (
         <li><a href={citation.url}>{citation.title}</a></li>
       ))}</ol></aside>`,
    );
    writeFileSync(
      path.join(root, "src", "SourcedAnswer.tsx"),
      `return <main><p>{answer}</p><Citations citations={citations} /></main>;`,
    );

    const result = analyzeSourcedAnswerRepository(root, [
      { criterionId: "official-domains", text: "official domains", required: true },
      { criterionId: "source-metadata", text: "source metadata", required: true },
      { criterionId: "visible-citations", text: "visible citations", required: true },
      { criterionId: "clickable-citations", text: "clickable citations", required: true },
    ]);
    expect(result.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterionId: "official-domains", status: "verified" }),
        expect.objectContaining({ criterionId: "source-metadata", status: "verified" }),
        expect.objectContaining({ criterionId: "visible-citations", status: "verified" }),
        expect.objectContaining({ criterionId: "clickable-citations", status: "verified" }),
      ]),
    );
    expect(
      result.evidence.filter((evidence) => evidence.criterionId === "visible-citations"),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ path: "src/Citations.tsx" })]));
  });

  it("does not accept an unrelated anchor as a clickable citation", () => {
    const root = mkdtempSync(path.join(tmpdir(), "evidencegate-analyzer-link-negative-"));
    mkdirSync(path.join(root, "src"));
    writeFileSync(
      path.join(root, "src", "Navigation.tsx"),
      `export function Navigation() { return <a href="/docs">Documentation</a>; }`,
    );

    const result = analyzeSourcedAnswerRepository(root, [
      { criterionId: "clickable-citations", text: "clickable citations", required: true },
    ]);

    expect(result.assessments[0]).toEqual(
      expect.objectContaining({ criterionId: "clickable-citations", status: "unsupported" }),
    );
  });

  it("does not treat returnedSources or a broad openai.com allowlist as complete evidence", () => {
    const root = mkdtempSync(path.join(tmpdir(), "evidencegate-analyzer-negative-"));
    mkdirSync(path.join(root, "src"));
    writeFileSync(
      path.join(root, "src", "server.ts"),
      `const OFFICIAL_OPENAI_DOMAINS = ["developers.openai.com", "platform.openai.com", "openai.com"];
       const returnedSources = [];
       const request = { filters: { allowed_domains: OFFICIAL_OPENAI_DOMAINS } };`,
    );

    const result = analyzeSourcedAnswerRepository(root, [
      { criterionId: "official-domains", text: "official domains", required: true },
      { criterionId: "visible-citations", text: "visible citations", required: true },
    ]);
    expect(result.assessments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ criterionId: "official-domains", status: "partially_verified" }),
        expect.objectContaining({ criterionId: "visible-citations", status: "unsupported" }),
      ]),
    );
  });

  it("requires API annotation extraction and native URL-citation fields", () => {
    const completeRoot = mkdtempSync(path.join(tmpdir(), "evidencegate-analyzer-citations-"));
    mkdirSync(path.join(completeRoot, "src"));
    writeFileSync(
      path.join(completeRoot, "src", "server.ts"),
      `const annotations = outputText?.type === "output_text" ? outputText.annotations : [];
       const citations = parseCitationAnnotations(text, annotations, sourceRegistry);`,
    );
    writeFileSync(
      path.join(completeRoot, "src", "citations.mjs"),
      `return annotations.filter((annotation) => annotation.type === "url_citation").map((annotation) => ({
         url: annotation.url,
         title: annotation.title,
         startIndex: annotation.start_index,
         endIndex: annotation.end_index,
       }));`,
    );

    const complete = analyzeSourcedAnswerRepository(completeRoot, [
      { criterionId: "citation-annotations", text: "citation annotations", required: true },
    ]);
    expect(complete.assessments[0]).toEqual(
      expect.objectContaining({ criterionId: "citation-annotations", status: "verified" }),
    );
    expect(complete.evidence).toHaveLength(6);

    const superficialRoot = mkdtempSync(
      path.join(tmpdir(), "evidencegate-analyzer-citations-superficial-"),
    );
    mkdirSync(path.join(superficialRoot, "src"));
    writeFileSync(
      path.join(superficialRoot, "src", "config.ts"),
      `export const labels = ["annotations", "url_citation"];`,
    );
    const superficial = analyzeSourcedAnswerRepository(superficialRoot, [
      { criterionId: "citation-annotations", text: "citation annotations", required: true },
    ]);
    expect(superficial.assessments[0]).toEqual(
      expect.objectContaining({ criterionId: "citation-annotations", status: "unsupported" }),
    );
  });

  it("selects evidence files in deterministic lexical path order", () => {
    const root = mkdtempSync(path.join(tmpdir(), "evidencegate-analyzer-order-"));
    mkdirSync(path.join(root, "src"));
    const matchingSource = `const returned = sourceRegistry.has(citation.url);`;
    writeFileSync(path.join(root, "src", "z-registry.ts"), matchingSource);
    writeFileSync(path.join(root, "src", "A-registry.ts"), matchingSource);

    const result = analyzeSourcedAnswerRepository(root, [
      { criterionId: "source-identifiers", text: "source identifiers", required: true },
    ]);

    expect(result.assessments[0]).toEqual(
      expect.objectContaining({ criterionId: "source-identifiers", status: "verified" }),
    );
    expect(new Set(result.evidence.map((evidence) => evidence.path))).toEqual(
      new Set(["src/A-registry.ts"]),
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  createSourcePolicy,
  detectSourceConflicts,
  evaluateFreshness,
  type ExternalSourceRecord,
} from "../src/index.js";

describe("source freshness", () => {
  it("uses publication age rather than retrieval time alone", () => {
    expect(
      evaluateFreshness({
        publishedAt: "2026-07-10T00:00:00.000Z",
        retrievedAt: "2026-07-18T00:00:00.000Z",
        maxSourceAgeDays: 30,
      }).status,
    ).toBe("current");
    expect(
      evaluateFreshness({
        publishedAt: "2026-05-01T00:00:00.000Z",
        retrievedAt: "2026-07-18T00:00:00.000Z",
        maxSourceAgeDays: 30,
      }).status,
    ).toBe("stale");
    expect(
      evaluateFreshness({
        retrievedAt: "2026-07-18T00:00:00.000Z",
        maxSourceAgeDays: 30,
      }).status,
    ).toBe("unknown");
  });

  it("treats a null age limit as freshness-eligible even without publication metadata", () => {
    expect(createSourcePolicy("official_only", { maxSourceAgeDays: null }).maxSourceAgeDays).toBe(
      null,
    );
    expect(
      evaluateFreshness({
        retrievedAt: "2026-07-18T00:00:00.000Z",
        maxSourceAgeDays: null,
      }),
    ).toMatchObject({ status: "current", ageDays: null, dateUsed: null });
    expect(
      evaluateFreshness({
        publishedAt: "2020-01-01T00:00:00.000Z",
        retrievedAt: "2026-07-18T00:00:00.000Z",
        maxSourceAgeDays: null,
      }).status,
    ).toBe("current");
  });
});

function source(
  sourceId: string,
  supported: string[],
  contradicted: string[],
): ExternalSourceRecord {
  return {
    sourceId,
    webSearchCallId: `ws-${sourceId}`,
    url: `https://example.com/${sourceId}`,
    normalizedUrl: `https://example.com/${sourceId}`,
    title: sourceId,
    domain: "example.com",
    retrievedAt: "2026-07-18T00:00:00.000Z",
    sourceType: "official_documentation",
    isPrimary: true,
    isOfficial: true,
    allowedByPolicy: true,
    freshnessStatus: "current",
    citationAnnotations: [],
    claimsSupported: supported,
    claimsContradicted: contradicted,
    limitations: [],
  };
}

describe("source conflict detection", () => {
  it("preserves opposing source claims for manual review", () => {
    const conflicts = detectSourceConflicts([
      source("current", ["The option is required"], []),
      source("older", [], ["the option is required"]),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      supportingSourceIds: ["current"],
      contradictingSourceIds: ["older"],
      requiresManualReview: true,
    });
  });
});

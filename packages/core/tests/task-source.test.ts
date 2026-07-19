import { describe, expect, it } from "vitest";

import {
  CitationAnnotationSchema,
  ExternalSourceRecordSchema,
  HttpUrlSchema,
  TaskSpecificationSchema,
  hostnameMatches,
  normalizeSourceUrl,
} from "../src/index.js";
import { makeTask } from "./fixtures.js";

describe("task schemas", () => {
  it("accepts a strict valid task", () => {
    expect(TaskSpecificationSchema.parse(makeTask()).taskId).toBe("task-1");
  });

  it("rejects duplicate criterion IDs", () => {
    const task = makeTask();
    task.acceptanceCriteria.push({ ...task.acceptanceCriteria[0]! });
    const result = TaskSpecificationSchema.safeParse(task);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.message.includes("Duplicate criterion ID")),
      ).toBe(true);
    }
  });

  it("rejects unknown keys and invalid timestamps", () => {
    expect(
      TaskSpecificationSchema.safeParse({ ...makeTask(), createdAt: "yesterday", surprise: true })
        .success,
    ).toBe(false);
  });
});

describe("source and citation schemas", () => {
  it("rejects unsafe schemes", () => {
    const result = ExternalSourceRecordSchema.safeParse({
      sourceId: "source-1",
      webSearchCallId: "call-1",
      url: "javascript:alert(1)",
      normalizedUrl: "javascript:alert(1)",
      title: "Unsafe",
      domain: "example.com",
      retrievedAt: "2026-07-18T06:00:00.000Z",
      sourceType: "unknown",
      isPrimary: false,
      isOfficial: false,
      allowedByPolicy: false,
      freshnessStatus: "unknown",
      citationAnnotations: [],
      claimsSupported: [],
      claimsContradicted: [],
      limitations: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects credential-bearing HTTP source URLs", () => {
    expect(HttpUrlSchema.safeParse("https://user:secret@example.com/docs").success).toBe(false);
    expect(() => normalizeSourceUrl("https://user:secret@example.com/docs")).toThrow(
      "embedded credentials",
    );
  });

  it("rejects invalid citation ranges", () => {
    expect(
      CitationAnnotationSchema.safeParse({
        citationId: "citation-1",
        sourceId: "source-1",
        startIndex: 10,
        endIndex: 3,
      }).success,
    ).toBe(false);
  });

  it("normalizes safe tracking data and matches hostnames exactly", () => {
    expect(normalizeSourceUrl("HTTPS://Developers.OpenAI.com/docs?utm_source=x&b=2&a=1#part")).toBe(
      "https://developers.openai.com/docs?a=1&b=2",
    );
    expect(hostnameMatches("developers.openai.com", "openai.com", true)).toBe(true);
    expect(hostnameMatches("developers.openai.com.evil.example", "openai.com", true)).toBe(false);
    expect(hostnameMatches("openai.com.fake-domain.example", "openai.com", false)).toBe(false);
  });
});

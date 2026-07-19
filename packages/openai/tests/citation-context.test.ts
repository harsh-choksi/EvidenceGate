import { describe, expect, it } from "vitest";

import { extractCitedNarrativeContexts } from "../src/index.js";

describe("cited narrative contexts", () => {
  it("binds each source to its surrounding cited claim line and deduplicates it", () => {
    const first = "- Source metadata is returned. [Docs A]";
    const second = "- Citations must be visible and clickable. [Docs B]";
    const narrative = `${first}\n${second}`;
    const firstStart = narrative.indexOf("[Docs A]");
    const secondStart = narrative.indexOf("[Docs B]");

    expect(
      extractCitedNarrativeContexts(narrative, [
        { startIndex: firstStart, endIndex: firstStart + "[Docs A]".length },
        { startIndex: firstStart, endIndex: firstStart + "[Docs A]".length },
        { startIndex: secondStart, endIndex: secondStart + "[Docs B]".length },
      ]),
    ).toEqual([first, second]);
  });

  it("skips invalid ranges and keeps a long context window around the citation", () => {
    const narrative = `${"a".repeat(200)}[Docs]${"b".repeat(200)}`;
    const startIndex = narrative.indexOf("[Docs]");
    const contexts = extractCitedNarrativeContexts(
      narrative,
      [
        { startIndex: -1, endIndex: 2 },
        { startIndex, endIndex: startIndex + "[Docs]".length },
      ],
      80,
    );

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toContain("[Docs]");
    expect(contexts[0]).toHaveLength(80);
  });

  it("rejects an invalid maximum length", () => {
    expect(() => extractCitedNarrativeContexts("text", [], 0)).toThrow(RangeError);
  });
});

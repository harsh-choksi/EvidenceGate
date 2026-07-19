import { describe, expect, it } from "vitest";
import { parseNameStatus, truncateUtf8 } from "../src/index.js";

describe("Git collection helpers", () => {
  it("classifies and preserves rename paths", () => {
    expect(parseNameStatus("M\tsrc/a.ts\nA\tsrc/b.ts\nR100\tsrc/old.ts\tsrc/new.ts")).toEqual([
      { path: "src/a.ts", status: "modified" },
      { path: "src/b.ts", status: "added" },
      { path: "src/new.ts", previousPath: "src/old.ts", status: "renamed" },
    ]);
  });

  it("bounds UTF-8 diff output", () => {
    const result = truncateUtf8("abcdefgh", 4);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.value, "utf8")).toBeGreaterThan(4);
    expect(result.value).toContain("diff truncated");
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/index.js";

describe("configuration", () => {
  it("accepts the documented example", () => {
    const value = parse(readFileSync(path.resolve(".evidencegate.example.yml"), "utf8"));
    expect(parseConfig(value).analysis.model).toBe("gpt-5.6");
  });

  it("rejects unknown top-level keys", () => {
    expect(() => parseConfig({ version: 1, surprise: true })).toThrow();
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { DEFAULT_OPENAI_MODEL, parseConfig, resolveOpenAIModel } from "../src/index.js";

describe("configuration", () => {
  it("accepts the documented example", () => {
    const value = parse(readFileSync(path.resolve(".evidencegate.example.yml"), "utf8"));
    expect(parseConfig(value).analysis.model).toBe("gpt-5.6-terra");
  });

  it("uses Terra by default and accepts a trimmed live-model override", () => {
    expect(DEFAULT_OPENAI_MODEL).toBe("gpt-5.6-terra");
    expect(resolveOpenAIModel()).toBe("gpt-5.6-terra");
    expect(resolveOpenAIModel({ EVIDENCEGATE_OPENAI_MODEL: "  gpt-5.6-luna  " })).toBe(
      "gpt-5.6-luna",
    );
    expect(() => resolveOpenAIModel({ EVIDENCEGATE_OPENAI_MODEL: "   " })).toThrow(
      "EVIDENCEGATE_OPENAI_MODEL must be a non-empty model ID",
    );
  });

  it("rejects unknown top-level keys", () => {
    expect(() => parseConfig({ version: 1, surprise: true })).toThrow();
  });
});

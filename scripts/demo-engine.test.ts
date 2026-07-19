import { describe, expect, it } from "vitest";

import {
  demoClaimProjections,
  demoInvariantErrorMessage,
  demoOutputDirectory,
  type DemoScenarioResult,
} from "./demo-engine.js";

describe("demo artifact isolation and diagnostics", () => {
  it("keeps live outputs beneath a separate directory", () => {
    expect(
      demoOutputDirectory("corrected", "live")
        .replaceAll("\\", "/")
        .endsWith("/.evidencegate/demo/live/corrected"),
    ).toBe(true);
    expect(
      demoOutputDirectory("corrected", "cached")
        .replaceAll("\\", "/")
        .endsWith("/.evidencegate/demo/corrected"),
    ).toBe(true);
  });

  it("reports actionable gate and artifact details for an invariant failure", () => {
    const result = {
      scenario: "corrected",
      sourceMode: "live",
      gateStatus: "fail",
      gateSummary: "fail: 10/14 required criteria verified",
      gateReasonCodes: ["required_criterion_partially_verified"],
      nonPassingCriterionIds: ["official-domains", "visible-citations"],
      bundlePath: "C:/demo/live/corrected/evidence-bundle.json",
      reportPath: "C:/demo/live/corrected/report.html",
      bundleHash: "hash",
      commandResult: {} as DemoScenarioResult["commandResult"],
    } satisfies DemoScenarioResult;

    const message = demoInvariantErrorMessage(result, "pass");
    expect(message).toContain("produced fail; expected pass");
    expect(message).toContain("official-domains, visible-citations");
    expect(message).toContain(result.bundlePath);
    expect(message).toContain(result.reportPath);
  });

  it("keeps citation parsing separate from returned-source binding", () => {
    const projection = demoClaimProjections["citation-annotations"];
    expect(projection?.internalClaim).toContain("url_citation");
    expect(projection?.internalClaim).toContain("start_index");
    expect(projection?.internalClaim).toContain("end_index");
    expect(projection?.internalClaim).not.toMatch(/bind|returned sources|source registry/iu);
    expect(demoClaimProjections["source-identifiers"]).toBeUndefined();
  });
});

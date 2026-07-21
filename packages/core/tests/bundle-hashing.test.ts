import { describe, expect, it } from "vitest";

import {
  CURRENT_GATE_POLICY_VERSION,
  EvidenceBundleSchema,
  canonicalStringify,
  computeBundleHash,
  createEvidenceBundle,
  evaluateGate,
  parseEvidenceBundle,
  resolveGatePolicy,
  verifyBundleHash,
} from "../src/index.js";
import { makeUnsignedBundle } from "./fixtures.js";

describe("canonical bundle hashing", () => {
  it("is stable across object key insertion order", () => {
    expect(canonicalStringify({ z: 1, a: { y: 2, x: 3 } })).toBe(
      canonicalStringify({ a: { x: 3, y: 2 }, z: 1 }),
    );
  });

  it("excludes bundleHash from its own calculation", () => {
    const bundle = createEvidenceBundle(makeUnsignedBundle());
    const changedHashField = { ...bundle, bundleHash: "0".repeat(64) };
    expect(computeBundleHash(bundle)).toBe(computeBundleHash(changedHashField));
    expect(bundle.bundleHash).toBe(computeBundleHash(bundle));
    expect(verifyBundleHash(bundle)).toBe(true);
  });

  it("detects content tampering", () => {
    const bundle = createEvidenceBundle(makeUnsignedBundle());
    const tampered = {
      ...bundle,
      task: { ...bundle.task, title: "Tampered title" },
    };
    expect(verifyBundleHash(tampered)).toBe(false);
    expect(() => parseEvidenceBundle(tampered)).toThrow(/hash mismatch/i);
  });
});

describe("bundle reference integrity", () => {
  it("rejects fabricated citation source IDs", () => {
    const bundle = createEvidenceBundle(makeUnsignedBundle());
    const fabricated = structuredClone(bundle);
    fabricated.externalSources[0]!.citationAnnotations[0]!.sourceId = "fabricated-source";

    const result = EvidenceBundleSchema.safeParse(fabricated);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes("fabricated-source"))).toBe(
        true,
      );
    }
  });

  it("rejects fabricated evidence and source references", () => {
    const bundle = createEvidenceBundle(makeUnsignedBundle());
    const fabricated = structuredClone(bundle);
    fabricated.combinedClaimAssessments[0]!.internalEvidenceIds = ["fabricated-evidence"];
    fabricated.externalClaimAssessments[0]!.supportingSourceIds = ["fabricated-source"];

    const result = EvidenceBundleSchema.safeParse(fabricated);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join("\n");
      expect(messages).toContain("fabricated-evidence");
      expect(messages).toContain("fabricated-source");
    }
  });

  it("rejects duplicate IDs and normalized URLs", () => {
    const unsigned = makeUnsignedBundle();
    unsigned.externalSources.push({
      ...structuredClone(unsigned.externalSources[0]!),
      citationAnnotations: [],
    });
    expect(() => createEvidenceBundle(unsigned)).toThrow(/Duplicate/);
  });
});

describe("research provenance integrity", () => {
  function externalResearchRun(
    modelRunId: string,
    toolCallIds: string[],
  ): ReturnType<typeof makeUnsignedBundle>["modelRuns"][number] {
    return {
      modelRunId,
      criterionIds: ["criterion-1"],
      purpose: "external_research",
      model: "gpt-5.6-terra",
      startedAt: "2026-07-18T06:00:00.000Z",
      completedAt: "2026-07-18T06:00:01.000Z",
      status: "completed",
      toolCallIds,
    };
  }

  it("accepts legacy single-call sources without webSearchCallIds", () => {
    const bundle = createEvidenceBundle(makeUnsignedBundle());

    expect(bundle.externalSources[0]?.webSearchCallId).toBe("search-call-1");
    expect(bundle.externalSources[0]?.webSearchCallIds).toBeUndefined();
    expect(parseEvidenceBundle(bundle).bundleHash).toBe(bundle.bundleHash);
  });

  it("binds one deduplicated source to every research run that returned it", () => {
    const unsigned = makeUnsignedBundle();
    unsigned.externalSources[0]!.webSearchCallIds = ["search-call-1", "search-call-2"];
    unsigned.researchRuns.push({
      ...structuredClone(unsigned.researchRuns[0]!),
      researchRunId: "research-run-2",
      webSearchCallIds: ["search-call-2"],
    });
    unsigned.modelRuns = [
      externalResearchRun("model-run-research-1", ["search-call-1"]),
      externalResearchRun("model-run-research-2", ["search-call-2"]),
    ];

    const bundle = createEvidenceBundle(unsigned);

    expect(bundle.externalSources[0]?.webSearchCallIds).toEqual(["search-call-1", "search-call-2"]);
    expect(bundle.researchRuns).toHaveLength(2);
    expect(verifyBundleHash(bundle)).toBe(true);
  });

  it("rejects duplicate source web-search call IDs", () => {
    const unsigned = makeUnsignedBundle();
    unsigned.externalSources[0]!.webSearchCallIds = ["search-call-1", "search-call-1"];

    expect(() => createEvidenceBundle(unsigned)).toThrow(/duplicate web-search call ID/i);
  });

  it("requires source webSearchCallIds to contain the singular primary call ID", () => {
    const unsigned = makeUnsignedBundle();
    unsigned.researchRuns[0]!.webSearchCallIds.push("search-call-2");
    unsigned.externalSources[0]!.webSearchCallIds = ["search-call-2"];

    expect(() => createEvidenceBundle(unsigned)).toThrow(
      /webSearchCallIds must include webSearchCallId/i,
    );
  });

  it("rejects unknown source web-search call IDs", () => {
    const unsigned = makeUnsignedBundle();
    unsigned.externalSources[0]!.webSearchCallIds = ["search-call-1", "search-call-unknown"];

    expect(() => createEvidenceBundle(unsigned)).toThrow(
      /unknown web-search call ID: search-call-unknown/i,
    );
  });

  it("rejects unknown tool calls on external-research model runs", () => {
    const unsigned = makeUnsignedBundle();
    unsigned.modelRuns = [externalResearchRun("model-run-research-1", ["search-call-unknown"])];

    expect(() => createEvidenceBundle(unsigned)).toThrow(
      /unknown web-search call ID: search-call-unknown/i,
    );
  });

  it("rejects a tool call shared by external-research model runs", () => {
    const unsigned = makeUnsignedBundle();
    unsigned.modelRuns = [
      externalResearchRun("model-run-research-1", ["search-call-1"]),
      externalResearchRun("model-run-research-2", ["search-call-1"]),
    ];

    expect(() => createEvidenceBundle(unsigned)).toThrow(
      /external-research tool-call ID is already assigned/i,
    );
  });
});

describe("semantic gate integrity", () => {
  it("rejects a forged pass even when the attacker recomputes the bundle hash", () => {
    const passingGate = structuredClone(makeUnsignedBundle().gate);
    const failedUnsigned = makeUnsignedBundle();
    failedUnsigned.internalClaimAssessments[0]!.status = "unsupported";
    failedUnsigned.combinedClaimAssessments[0]!.internalStatus = "unsupported";
    failedUnsigned.combinedClaimAssessments[0]!.combinedStatus = "unsupported";
    failedUnsigned.gate = evaluateGate({
      task: failedUnsigned.task,
      combinedClaimAssessments: failedUnsigned.combinedClaimAssessments,
      internalEvidence: failedUnsigned.internalEvidence,
      findings: failedUnsigned.findings,
    });

    const legitimateFailure = createEvidenceBundle(failedUnsigned);
    const forgedPass = structuredClone(legitimateFailure);
    forgedPass.gate = passingGate;
    forgedPass.bundleHash = computeBundleHash(forgedPass);

    expect(forgedPass.bundleHash).toBe(computeBundleHash(forgedPass));
    expect(EvidenceBundleSchema.safeParse(forgedPass).success).toBe(false);
    expect(verifyBundleHash(forgedPass)).toBe(false);
    expect(() => parseEvidenceBundle(forgedPass)).toThrow(/deterministic evaluation/i);
  });

  it("rejects a forged gate during bundle creation", () => {
    const unsigned = makeUnsignedBundle();
    unsigned.combinedClaimAssessments[0]!.internalStatus = "unsupported";
    unsigned.combinedClaimAssessments[0]!.combinedStatus = "unsupported";

    expect(() => createEvidenceBundle(unsigned)).toThrow(/deterministic evaluation/i);
  });

  it("rejects rehashed mismatches in gate arrays and summary", () => {
    const bundle = createEvidenceBundle(makeUnsignedBundle());
    const mismatchedSummary = structuredClone(bundle);
    mismatchedSummary.gate.summary = "pass: forged summary";
    mismatchedSummary.bundleHash = computeBundleHash(mismatchedSummary);

    const mismatchedArrays = structuredClone(bundle);
    mismatchedArrays.gate.failedCriterionIds = ["criterion-1"];
    mismatchedArrays.bundleHash = computeBundleHash(mismatchedArrays);

    for (const forged of [mismatchedSummary, mismatchedArrays]) {
      expect(verifyBundleHash(forged)).toBe(false);
      expect(() => parseEvidenceBundle(forged)).toThrow(/deterministic evaluation/i);
    }
  });

  it("rejects unsupported deterministic gate policy versions", () => {
    const unsigned = makeUnsignedBundle();
    unsigned.gatePolicyVersion = "deterministic-v999";
    expect(() => createEvidenceBundle(unsigned)).toThrow(/unsupported gate policy version/i);
  });

  it("recomputes a configurable policy bundle with its exact stored inputs", () => {
    const unsigned = makeUnsignedBundle();
    const gatePolicy = resolveGatePolicy({ failOnUnsupportedRequiredCriterion: false });
    unsigned.internalClaimAssessments[0]!.status = "unsupported";
    unsigned.combinedClaimAssessments[0]!.internalStatus = "unsupported";
    unsigned.combinedClaimAssessments[0]!.combinedStatus = "unsupported";
    unsigned.gatePolicyVersion = CURRENT_GATE_POLICY_VERSION;
    unsigned.gatePolicy = gatePolicy;
    unsigned.gate = evaluateGate(
      {
        task: unsigned.task,
        combinedClaimAssessments: unsigned.combinedClaimAssessments,
        internalEvidence: unsigned.internalEvidence,
        findings: unsigned.findings,
      },
      gatePolicy,
    );

    const bundle = createEvidenceBundle(unsigned);
    expect(bundle.gate.status).toBe("pass_with_warnings");
    expect(parseEvidenceBundle(bundle).gatePolicy).toEqual(gatePolicy);
  });

  it("rejects rehashed gate-policy tampering when the stored gate is unchanged", () => {
    const unsigned = makeUnsignedBundle();
    const gatePolicy = resolveGatePolicy({ failOnUnsupportedRequiredCriterion: false });
    unsigned.internalClaimAssessments[0]!.status = "unsupported";
    unsigned.combinedClaimAssessments[0]!.internalStatus = "unsupported";
    unsigned.combinedClaimAssessments[0]!.combinedStatus = "unsupported";
    unsigned.gatePolicyVersion = CURRENT_GATE_POLICY_VERSION;
    unsigned.gatePolicy = gatePolicy;
    unsigned.gate = evaluateGate(
      {
        task: unsigned.task,
        combinedClaimAssessments: unsigned.combinedClaimAssessments,
        internalEvidence: unsigned.internalEvidence,
        findings: unsigned.findings,
      },
      gatePolicy,
    );
    const tampered = structuredClone(createEvidenceBundle(unsigned));
    tampered.gatePolicy!.failOnUnsupportedRequiredCriterion = true;
    tampered.bundleHash = computeBundleHash(tampered);

    expect(tampered.bundleHash).toBe(computeBundleHash(tampered));
    expect(EvidenceBundleSchema.safeParse(tampered).success).toBe(false);
    expect(() => parseEvidenceBundle(tampered)).toThrow(/deterministic evaluation/i);
  });

  it("requires policy inputs for v2 and forbids them on legacy v1 bundles", () => {
    const missingPolicy = makeUnsignedBundle();
    missingPolicy.gatePolicyVersion = CURRENT_GATE_POLICY_VERSION;
    expect(() => createEvidenceBundle(missingPolicy)).toThrow(
      /must include the gate policy inputs/i,
    );

    const legacyWithPolicy = makeUnsignedBundle();
    legacyWithPolicy.gatePolicy = resolveGatePolicy();
    expect(() => createEvidenceBundle(legacyWithPolicy)).toThrow(/cannot include configurable/i);
  });

  it.each([
    {
      name: "internal status",
      mutate: (bundle: ReturnType<typeof createEvidenceBundle>) => {
        bundle.internalClaimAssessments[0]!.status = "unsupported";
      },
      expected: /internalStatus does not match internal assessment/i,
    },
    {
      name: "internal supporting evidence",
      mutate: (bundle: ReturnType<typeof createEvidenceBundle>) => {
        bundle.internalClaimAssessments[0]!.supportingEvidenceIds = [];
      },
      expected: /supporting evidence IDs do not match internal assessment/i,
    },
    {
      name: "internal contradicting evidence",
      mutate: (bundle: ReturnType<typeof createEvidenceBundle>) => {
        bundle.internalClaimAssessments[0]!.contradictingEvidenceIds = ["evidence-1"];
      },
      expected: /contradicting evidence IDs do not match internal assessment/i,
    },
    {
      name: "external status",
      mutate: (bundle: ReturnType<typeof createEvidenceBundle>) => {
        bundle.externalClaimAssessments[0]!.status = "not_supported";
      },
      expected: /externalStatus does not match external assessment/i,
    },
    {
      name: "external source IDs",
      mutate: (bundle: ReturnType<typeof createEvidenceBundle>) => {
        bundle.externalClaimAssessments[0]!.supportingSourceIds = [];
      },
      expected: /external source IDs do not match external assessment/i,
    },
    {
      name: "combined status",
      mutate: (bundle: ReturnType<typeof createEvidenceBundle>) => {
        bundle.combinedClaimAssessments[0]!.combinedStatus = "unsupported";
      },
      expected: /combined status does not match deterministic derivation/i,
    },
    {
      name: "normalized claim",
      mutate: (bundle: ReturnType<typeof createEvidenceBundle>) => {
        bundle.internalClaimAssessments[0]!.normalizedClaim = "A substituted claim";
        bundle.externalClaimAssessments[0]!.normalizedClaim = "A substituted claim";
        bundle.combinedClaimAssessments[0]!.normalizedClaim = "A substituted claim";
      },
      expected: /normalized claim does not match task criterion/i,
    },
  ])("rejects a rehashed $name divergence across assessment layers", ({ mutate, expected }) => {
    const tampered = structuredClone(createEvidenceBundle(makeUnsignedBundle()));
    mutate(tampered);
    tampered.bundleHash = computeBundleHash(tampered);

    expect(tampered.bundleHash).toBe(computeBundleHash(tampered));
    expect(EvidenceBundleSchema.safeParse(tampered).success).toBe(false);
    expect(() => parseEvidenceBundle(tampered)).toThrow(expected);
  });
});

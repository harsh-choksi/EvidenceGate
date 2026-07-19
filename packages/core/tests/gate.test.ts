import { describe, expect, it } from "vitest";

import { DEFAULT_GATE_POLICY, GatePolicySchema, evaluateGate } from "../src/index.js";
import { makeCombinedAssessment, makeTask } from "./fixtures.js";

describe("deterministic gate engine", () => {
  it("passes a required hybrid criterion only when both domains pass", () => {
    const task = makeTask("hybrid");
    const gate = evaluateGate({
      task,
      combinedClaimAssessments: [makeCombinedAssessment()],
    });
    expect(gate.status).toBe("pass");
  });

  it("does not trust a model-provided verified label when internal evidence is unsupported", () => {
    const task = makeTask("hybrid");
    const gate = evaluateGate({
      task,
      combinedClaimAssessments: [
        makeCombinedAssessment({
          internalStatus: "unsupported",
          externalStatus: "supported",
          combinedStatus: "verified",
        }),
      ],
    });
    expect(gate.status).toBe("fail");
    expect(gate.criterionResults[0]?.derivedStatus).toBe("unsupported");
  });

  it("fails hybrid claims when external authority is absent despite verified code", () => {
    const gate = evaluateGate({
      task: makeTask("hybrid"),
      combinedClaimAssessments: [
        makeCombinedAssessment({ externalStatus: "not_supported", combinedStatus: "verified" }),
      ],
    });
    expect(gate.status).toBe("fail");
  });

  it("routes conflicting authoritative sources to manual review", () => {
    const gate = evaluateGate({
      task: makeTask("hybrid"),
      combinedClaimAssessments: [
        makeCombinedAssessment({
          externalStatus: "conflicting_sources",
          combinedStatus: "verified",
        }),
      ],
    });
    expect(gate.status).toBe("manual_review");
  });

  it("distinguishes a required source failure from an implementation failure", () => {
    const gate = evaluateGate({
      task: makeTask("external"),
      combinedClaimAssessments: [
        makeCombinedAssessment({
          evidenceDomain: "external",
          internalStatus: "not_applicable",
          externalStatus: "source_error",
          combinedStatus: "verified",
        }),
      ],
    });
    expect(gate.status).toBe("source_error");
  });

  it("returns pass with warnings for an unsupported optional criterion", () => {
    const gate = evaluateGate({
      task: makeTask("internal", false),
      combinedClaimAssessments: [
        makeCombinedAssessment({
          evidenceDomain: "internal",
          internalStatus: "unsupported",
          externalStatus: "not_applicable",
        }),
      ],
    });
    expect(gate.status).toBe("pass_with_warnings");
  });

  it("fails on a required command failure", () => {
    const gate = evaluateGate({
      task: makeTask("internal"),
      combinedClaimAssessments: [
        makeCombinedAssessment({
          evidenceDomain: "internal",
          externalStatus: "not_applicable",
        }),
      ],
      internalEvidence: [
        {
          evidenceId: "test-command",
          criterionIds: ["criterion-1"],
          kind: "test_result",
          status: "failed",
          summary: "Tests failed.",
          required: true,
        },
      ],
    });
    expect(gate.status).toBe("fail");
    expect(gate.reasonCodes).toContain("required_command_failed");
  });

  it("downgrades an internal contradiction when configured not to fail", () => {
    const gate = evaluateGate(
      {
        task: makeTask("internal"),
        combinedClaimAssessments: [
          makeCombinedAssessment({
            evidenceDomain: "internal",
            internalStatus: "contradicted",
            externalStatus: "not_applicable",
          }),
        ],
      },
      { failOnContradictedRequiredCriterion: false },
    );

    expect(gate.status).toBe("pass_with_warnings");
    expect(gate.warningCriterionIds).toEqual(["criterion-1"]);
  });

  it("ignores a critical finding as a blocker when configured not to fail", () => {
    const gate = evaluateGate(
      {
        task: makeTask("hybrid"),
        combinedClaimAssessments: [makeCombinedAssessment()],
        findings: [
          {
            findingId: "finding-critical",
            criterionIds: ["criterion-1"],
            severity: "critical",
            category: "security",
            title: "Critical finding",
            description: "A critical finding used to exercise the gate policy.",
            evidenceIds: [],
            sourceIds: [],
          },
        ],
      },
      { failOnCriticalFinding: false },
    );

    expect(gate.status).toBe("pass");
    expect(gate.reasonCodes).not.toContain("critical_finding");
  });

  it("downgrades a required source error when configured not to fail", () => {
    const gate = evaluateGate(
      {
        task: makeTask("external"),
        combinedClaimAssessments: [
          makeCombinedAssessment({
            evidenceDomain: "external",
            internalStatus: "not_applicable",
            externalStatus: "source_error",
          }),
        ],
      },
      { external: { failOnRequiredSourceError: false } },
    );

    expect(gate.status).toBe("pass_with_warnings");
    expect(gate.warningCriterionIds).toEqual(["criterion-1"]);
    expect(gate.reasonCodes).toContain("source_error");
  });

  it("downgrades a required external contradiction when configured not to fail", () => {
    const gate = evaluateGate(
      {
        task: makeTask("external"),
        combinedClaimAssessments: [
          makeCombinedAssessment({
            evidenceDomain: "external",
            internalStatus: "not_applicable",
            externalStatus: "contradicted",
          }),
        ],
      },
      { external: { failOnRequiredExternalContradiction: false } },
    );

    expect(gate.status).toBe("pass_with_warnings");
    expect(gate.warningCriterionIds).toEqual(["criterion-1"]);
  });

  it("uses the conflict setting to choose manual review or unsupported enforcement", () => {
    const input = {
      task: makeTask("hybrid"),
      combinedClaimAssessments: [
        makeCombinedAssessment({
          externalStatus: "conflicting_sources" as const,
        }),
      ],
    };

    expect(evaluateGate(input).status).toBe("manual_review");
    expect(
      evaluateGate(input, {
        external: { manualReviewOnConflictingSources: false },
      }).status,
    ).toBe("fail");
  });

  it("keeps the hybrid two-domain invariant schema-locked on", () => {
    const attemptedPolicy = {
      ...DEFAULT_GATE_POLICY,
      external: {
        ...DEFAULT_GATE_POLICY.external,
        requireBothDomainsForHybridClaims: false,
      },
    };

    expect(GatePolicySchema.safeParse(attemptedPolicy).success).toBe(false);
  });

  it("applies non-default criterion and command enforcement settings", () => {
    const task = makeTask("internal");
    const gate = evaluateGate(
      {
        task,
        combinedClaimAssessments: [
          makeCombinedAssessment({
            evidenceDomain: "internal",
            internalStatus: "unsupported",
            externalStatus: "not_applicable",
          }),
        ],
        internalEvidence: [
          {
            evidenceId: "test-command",
            criterionIds: ["criterion-1"],
            kind: "test_result",
            status: "failed",
            summary: "Tests failed.",
            required: true,
          },
        ],
      },
      {
        failOnUnsupportedRequiredCriterion: false,
        failOnRequiredCommandFailure: false,
      },
    );

    expect(gate.status).toBe("pass_with_warnings");
    expect(gate.warningCriterionIds).toEqual(["criterion-1"]);
    expect(gate.reasonCodes).not.toContain("required_command_failed");
  });
});

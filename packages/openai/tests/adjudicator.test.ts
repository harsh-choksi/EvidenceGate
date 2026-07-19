import { describe, expect, it, vi } from "vitest";

import {
  AdjudicationValidationError,
  LiveOpenAIAdjudicationDisabledError,
  OpenAIEvidenceAdjudicator,
  buildAdjudicationRequest,
  isLiveOpenAIAdjudicationEnabled,
  type OpenAIAdjudicationClient,
} from "../src/index.js";
import {
  VALID_ADJUDICATION_INPUT,
  VALID_ADJUDICATION_OUTPUT,
  asResponsesApiOutput,
} from "./fixtures.js";

describe("OpenAI evidence adjudicator", () => {
  it("requires an explicit live opt-in", async () => {
    const create = vi.fn().mockResolvedValue(asResponsesApiOutput(VALID_ADJUDICATION_OUTPUT));
    const client = { responses: { create } } as OpenAIAdjudicationClient;
    const adjudicator = new OpenAIEvidenceAdjudicator(client);
    await expect(adjudicator.adjudicate(VALID_ADJUDICATION_INPUT)).rejects.toBeInstanceOf(
      LiveOpenAIAdjudicationDisabledError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("submits the structured request and validates the result", async () => {
    const create = vi.fn().mockResolvedValue(asResponsesApiOutput(VALID_ADJUDICATION_OUTPUT));
    const client = { responses: { create } } as OpenAIAdjudicationClient;
    const adjudicator = new OpenAIEvidenceAdjudicator(client, { liveEnabled: true });
    const result = await adjudicator.adjudicate(VALID_ADJUDICATION_INPUT);
    expect(create).toHaveBeenCalledWith(buildAdjudicationRequest(VALID_ADJUDICATION_INPUT));
    expect(result).toEqual(VALID_ADJUDICATION_OUTPUT);
  });

  it("records one rejected attempt and accepts one bounded correction", async () => {
    const invalidOutput = structuredClone(VALID_ADJUDICATION_OUTPUT);
    invalidOutput.externalClaimAssessments[0]!.supportingSourceIds = ["source-invented"];
    invalidOutput.combinedClaimAssessments[0]!.externalSourceIds = ["source-invented"];
    const create = vi
      .fn()
      .mockResolvedValueOnce(asResponsesApiOutput(invalidOutput))
      .mockResolvedValueOnce(asResponsesApiOutput(VALID_ADJUDICATION_OUTPUT));
    const client = { responses: { create } } as OpenAIAdjudicationClient;
    const adjudicator = new OpenAIEvidenceAdjudicator(client, {
      liveEnabled: true,
      maxValidationRetries: 1,
      now: () => new Date("2026-07-18T12:00:00.000Z"),
    });

    const result = await adjudicator.adjudicateDetailed(VALID_ADJUDICATION_INPUT);

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.output).toEqual(VALID_ADJUDICATION_OUTPUT);
    expect(result.attempts).toMatchObject([
      { attempt: 1, status: "validation_failed", validationIssueCount: 4 },
      { attempt: 2, status: "completed", validationIssueCount: 0 },
    ]);
    expect(result.attempts[0]?.inputHash).not.toBe(result.attempts[1]?.inputHash);
    const correctionRequest = create.mock.calls[1]?.[0] as { input: string; tools?: unknown };
    expect(correctionRequest).not.toHaveProperty("tools");
    expect(JSON.parse(correctionRequest.input)).toHaveProperty("validationFeedback");
  });

  it("fails closed after the single permitted correction attempt", async () => {
    const invalidOutput = structuredClone(VALID_ADJUDICATION_OUTPUT);
    invalidOutput.combinedClaimAssessments[0]!.combinedStatus = "manual_review";
    const create = vi.fn().mockResolvedValue(asResponsesApiOutput(invalidOutput));
    const client = { responses: { create } } as OpenAIAdjudicationClient;
    const adjudicator = new OpenAIEvidenceAdjudicator(client, {
      liveEnabled: true,
      maxValidationRetries: 1,
    });

    await expect(adjudicator.adjudicate(VALID_ADJUDICATION_INPUT)).rejects.toMatchObject({
      kind: "binding_violation",
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("does not retry a refusal", async () => {
    const create = vi.fn().mockResolvedValue({
      output: [{ type: "message", content: [{ type: "refusal", refusal: "Cannot comply." }] }],
    });
    const client = { responses: { create } } as OpenAIAdjudicationClient;
    const adjudicator = new OpenAIEvidenceAdjudicator(client, {
      liveEnabled: true,
      maxValidationRetries: 1,
    });

    await expect(adjudicator.adjudicate(VALID_ADJUDICATION_INPUT)).rejects.toMatchObject({
      kind: "refusal",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("keeps validation retries disabled by default", async () => {
    const invalidOutput = structuredClone(VALID_ADJUDICATION_OUTPUT);
    invalidOutput.combinedClaimAssessments[0]!.combinedStatus = "manual_review";
    const create = vi.fn().mockResolvedValue(asResponsesApiOutput(invalidOutput));
    const client = { responses: { create } } as OpenAIAdjudicationClient;
    const adjudicator = new OpenAIEvidenceAdjudicator(client, { liveEnabled: true });

    await expect(adjudicator.adjudicate(VALID_ADJUDICATION_INPUT)).rejects.toBeInstanceOf(
      AdjudicationValidationError,
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("enforces the retry bound at runtime", () => {
    const client = { responses: { create: vi.fn() } } as OpenAIAdjudicationClient;
    expect(
      () =>
        new OpenAIEvidenceAdjudicator(client, {
          liveEnabled: true,
          maxValidationRetries: 2 as 0 | 1,
        }),
    ).toThrow(RangeError);
  });

  it("requires both the environment flag and API key", () => {
    expect(
      isLiveOpenAIAdjudicationEnabled({
        RUN_LIVE_OPENAI_ADJUDICATION: "true",
        OPENAI_API_KEY: "test-key",
      }),
    ).toBe(true);
    expect(
      isLiveOpenAIAdjudicationEnabled({
        RUN_LIVE_OPENAI_ADJUDICATION: "false",
        OPENAI_API_KEY: "test-key",
      }),
    ).toBe(false);
    expect(
      isLiveOpenAIAdjudicationEnabled({
        RUN_LIVE_OPENAI_ADJUDICATION: "true",
      }),
    ).toBe(false);
  });
});

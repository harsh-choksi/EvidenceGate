import { createHash } from "node:crypto";

import {
  DEFAULT_ADJUDICATION_MODEL,
  buildAdjudicationRequest,
  type OpenAIAdjudicationRequest,
} from "./adjudication-request.js";
import {
  AdjudicationValidationError,
  validateAdjudicationResponse,
  type AdjudicationValidationIssue,
} from "./response-validator.js";
import type {
  AdjudicationInput,
  AdjudicationOutput,
  AdjudicationRunOptions,
  EvidenceAdjudicator,
} from "./types.js";

export interface OpenAIAdjudicationClient {
  responses: {
    create(
      request: OpenAIAdjudicationRequest,
      options?: { signal?: AbortSignal },
    ): Promise<unknown>;
  };
}

export interface OpenAIEvidenceAdjudicatorOptions {
  model?: string;
  liveEnabled?: boolean;
  maxValidationRetries?: 0 | 1;
  now?: () => Date;
}

export interface AdjudicationAttemptMetadata {
  attempt: number;
  status: "completed" | "validation_failed";
  startedAt: string;
  completedAt: string;
  inputHash: string;
  validationIssueCount: number;
  responseId?: string;
}

export interface DetailedAdjudicationResult {
  output: AdjudicationOutput;
  attempts: AdjudicationAttemptMetadata[];
}

export class LiveOpenAIAdjudicationDisabledError extends Error {
  public constructor() {
    super(
      "Live OpenAI evidence adjudication is disabled. Explicitly enable it, or set RUN_LIVE_OPENAI_ADJUDICATION=true with OPENAI_API_KEY.",
    );
    this.name = "LiveOpenAIAdjudicationDisabledError";
  }
}

export class OpenAIEvidenceAdjudicator implements EvidenceAdjudicator {
  public readonly name = "openai-evidence-adjudicator";
  private readonly model: string;
  private readonly liveEnabled: boolean;
  private readonly maxValidationRetries: 0 | 1;
  private readonly now: () => Date;

  public constructor(
    private readonly client: OpenAIAdjudicationClient,
    options: OpenAIEvidenceAdjudicatorOptions = {},
  ) {
    if (
      options.maxValidationRetries !== undefined &&
      options.maxValidationRetries !== 0 &&
      options.maxValidationRetries !== 1
    ) {
      throw new RangeError("maxValidationRetries must be 0 or 1.");
    }
    this.model = options.model ?? DEFAULT_ADJUDICATION_MODEL;
    this.liveEnabled = options.liveEnabled ?? false;
    this.maxValidationRetries = options.maxValidationRetries ?? 0;
    this.now = options.now ?? (() => new Date());
  }

  public async adjudicate(
    input: AdjudicationInput,
    options: AdjudicationRunOptions = {},
  ): Promise<AdjudicationOutput> {
    return (await this.adjudicateDetailed(input, options)).output;
  }

  public async adjudicateDetailed(
    input: AdjudicationInput,
    options: AdjudicationRunOptions = {},
  ): Promise<DetailedAdjudicationResult> {
    if (!this.liveEnabled) throw new LiveOpenAIAdjudicationDisabledError();

    const attempts: AdjudicationAttemptMetadata[] = [];
    let validationFeedback: readonly AdjudicationValidationIssue[] = [];

    for (let attempt = 1; attempt <= this.maxValidationRetries + 1; attempt += 1) {
      if (options.signal?.aborted === true) {
        throw options.signal.reason instanceof Error
          ? options.signal.reason
          : new Error("Evidence adjudication was aborted.");
      }

      const request = buildAdjudicationRequest(input, this.model, validationFeedback);
      const startedAt = this.now().toISOString();
      const response =
        options.signal === undefined
          ? await this.client.responses.create(request)
          : await this.client.responses.create(request, { signal: options.signal });
      const completedAt = this.now().toISOString();
      const responseId = extractResponseId(response);
      const inputHash = createHash("sha256").update(JSON.stringify(request)).digest("hex");

      try {
        const output = validateAdjudicationResponse(response, input);
        attempts.push({
          attempt,
          status: "completed",
          startedAt,
          completedAt,
          inputHash,
          validationIssueCount: 0,
          ...(responseId === undefined ? {} : { responseId }),
        });
        return { output, attempts };
      } catch (error) {
        if (!(error instanceof AdjudicationValidationError)) throw error;
        attempts.push({
          attempt,
          status: "validation_failed",
          startedAt,
          completedAt,
          inputHash,
          validationIssueCount: error.issues.length,
          ...(responseId === undefined ? {} : { responseId }),
        });
        const retryable = ["invalid_json", "schema_violation", "binding_violation"].includes(
          error.kind,
        );
        if (!retryable || attempt > this.maxValidationRetries || isAborted(options.signal)) {
          throw error;
        }
        validationFeedback = error.issues;
      }
    }

    throw new Error("Evidence adjudication exhausted its bounded attempts.");
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function extractResponseId(response: unknown): string | undefined {
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    return undefined;
  }
  const value = (response as Record<string, unknown>)["id"];
  return typeof value === "string" && /^\S{1,256}$/u.test(value) ? value : undefined;
}

export interface OpenAIAdjudicationEnvironment {
  OPENAI_API_KEY?: string;
  RUN_LIVE_OPENAI_ADJUDICATION?: string;
}

function currentEnvironment(): OpenAIAdjudicationEnvironment {
  return {
    ...(process.env["OPENAI_API_KEY"] === undefined
      ? {}
      : { OPENAI_API_KEY: process.env["OPENAI_API_KEY"] }),
    ...(process.env["RUN_LIVE_OPENAI_ADJUDICATION"] === undefined
      ? {}
      : {
          RUN_LIVE_OPENAI_ADJUDICATION: process.env["RUN_LIVE_OPENAI_ADJUDICATION"],
        }),
  };
}

export function isLiveOpenAIAdjudicationEnabled(
  environment: OpenAIAdjudicationEnvironment = currentEnvironment(),
): boolean {
  return (
    environment.RUN_LIVE_OPENAI_ADJUDICATION === "true" &&
    typeof environment.OPENAI_API_KEY === "string" &&
    environment.OPENAI_API_KEY.trim() !== ""
  );
}

export async function createOpenAIEvidenceAdjudicatorFromEnvironment(
  environment: OpenAIAdjudicationEnvironment = currentEnvironment(),
  options: Omit<OpenAIEvidenceAdjudicatorOptions, "liveEnabled"> = {},
): Promise<OpenAIEvidenceAdjudicator> {
  if (!isLiveOpenAIAdjudicationEnabled(environment)) {
    throw new LiveOpenAIAdjudicationDisabledError();
  }
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: environment.OPENAI_API_KEY });
  return new OpenAIEvidenceAdjudicator(client, {
    ...options,
    liveEnabled: true,
  });
}

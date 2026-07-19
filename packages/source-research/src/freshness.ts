import type { ExternalSourceRecord, FreshnessStatus } from "./types.js";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type FreshnessClaimKind =
  | "api_syntax"
  | "model_or_sdk_support"
  | "package_version"
  | "maintainer_guidance"
  | "security_standard"
  | "current_law"
  | "stable_technical_concept";

export const DEFAULT_MAX_SOURCE_AGE_DAYS: Record<FreshnessClaimKind, number> = {
  api_syntax: 30,
  model_or_sdk_support: 30,
  package_version: 7,
  maintainer_guidance: 90,
  security_standard: 365,
  current_law: 30,
  stable_technical_concept: 730,
};

export interface FreshnessEvaluationInput {
  publishedAt?: string;
  updatedAt?: string;
  retrievedAt: string;
  maxSourceAgeDays: number | null;
  asOf?: Date;
}

export interface FreshnessEvaluation {
  status: FreshnessStatus;
  ageDays: number | null;
  dateUsed: "updatedAt" | "publishedAt" | null;
  explanation: string;
}

function parseDate(value: string | undefined): Date | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function calculateAgeDays(older: Date, newer: Date): number {
  return (newer.getTime() - older.getTime()) / MILLISECONDS_PER_DAY;
}

export function evaluateFreshness(input: FreshnessEvaluationInput): FreshnessEvaluation {
  const asOf = input.asOf ?? parseDate(input.retrievedAt) ?? new Date();
  const updatedAt = parseDate(input.updatedAt);
  const publishedAt = parseDate(input.publishedAt);
  const sourceDate = updatedAt ?? publishedAt;
  const dateUsed =
    updatedAt === undefined ? (publishedAt === undefined ? null : "publishedAt") : "updatedAt";

  if (input.maxSourceAgeDays === null) {
    const ageDays = sourceDate === undefined ? null : calculateAgeDays(sourceDate, asOf);
    return {
      status: "current",
      ageDays: ageDays === null ? null : Math.max(0, ageDays),
      dateUsed,
      explanation: "No maximum source age is configured; freshness does not restrict eligibility.",
    };
  }

  if (sourceDate === undefined) {
    return {
      status: "unknown",
      ageDays: null,
      dateUsed: null,
      explanation:
        "No valid publication or update date was returned; retrieval time alone does not establish freshness.",
    };
  }

  const ageDays = calculateAgeDays(sourceDate, asOf);
  if (ageDays < -1) {
    return {
      status: "unknown",
      ageDays,
      dateUsed,
      explanation: "The source date is in the future, so freshness cannot be established.",
    };
  }

  const boundedAge = Math.max(0, ageDays);
  if (boundedAge > input.maxSourceAgeDays) {
    return {
      status: "stale",
      ageDays: boundedAge,
      dateUsed,
      explanation: `Source age exceeds the ${input.maxSourceAgeDays}-day freshness limit.`,
    };
  }

  if (input.maxSourceAgeDays > 0 && boundedAge > input.maxSourceAgeDays * 0.8) {
    return {
      status: "possibly_stale",
      ageDays: boundedAge,
      dateUsed,
      explanation: `Source is within 20% of the ${input.maxSourceAgeDays}-day freshness limit.`,
    };
  }

  return {
    status: "current",
    ageDays: boundedAge,
    dateUsed,
    explanation: `Source is within the ${input.maxSourceAgeDays}-day freshness limit.`,
  };
}

export function withEvaluatedFreshness(
  source: ExternalSourceRecord,
  maxSourceAgeDays: number | null,
  asOf?: Date,
): ExternalSourceRecord {
  const evaluation = evaluateFreshness({
    ...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt }),
    ...(source.updatedAt === undefined ? {} : { updatedAt: source.updatedAt }),
    retrievedAt: source.retrievedAt,
    maxSourceAgeDays,
    ...(asOf === undefined ? {} : { asOf }),
  });

  return {
    ...source,
    freshnessStatus: evaluation.status,
    limitations:
      evaluation.status === "current"
        ? [...source.limitations]
        : [...source.limitations, evaluation.explanation],
  };
}

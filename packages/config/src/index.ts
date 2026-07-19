import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";

export interface OpenAIModelEnvironment {
  EVIDENCEGATE_OPENAI_MODEL?: string;
}

export function resolveOpenAIModel(environment: OpenAIModelEnvironment = {}): string {
  const configuredModel = environment.EVIDENCEGATE_OPENAI_MODEL;
  if (configuredModel === undefined) return DEFAULT_OPENAI_MODEL;

  return z
    .string()
    .trim()
    .min(1, "EVIDENCEGATE_OPENAI_MODEL must be a non-empty model ID.")
    .parse(configuredModel);
}

const commandSchema = z
  .object({
    command: z.string().min(1),
    enabled: z.boolean(),
    timeoutSeconds: z.number().int().positive().max(3600),
    required: z.boolean(),
  })
  .strict();

const policySchema = z
  .object({
    sourcePolicy: z.enum([
      "official_only",
      "primary_sources",
      "standards_bodies",
      "vendor_documentation",
      "maintainer_sources",
      "peer_reviewed",
      "government_sources",
      "reputable_broad",
      "custom",
    ]),
    allowedDomains: z.array(z.string().min(1)).default([]),
    blockedDomains: z.array(z.string().min(1)).default([]),
    minimumSourceCount: z.number().int().positive().default(1),
    maxSourceAgeDays: z.number().int().positive().nullable().default(null),
  })
  .strict();

export const evidenceGateConfigSchema = z
  .object({
    version: z.literal(1),
    repository: z.object({ baseRef: z.string().min(1), headRef: z.string().min(1) }).strict(),
    commands: z.record(z.string(), commandSchema),
    analysis: z
      .object({
        model: z.string().min(1).default(DEFAULT_OPENAI_MODEL),
        maxChangedFiles: z.number().int().positive().default(100),
        maxDiffBytes: z.number().int().positive().default(500_000),
        redactSecrets: z.boolean().default(true),
      })
      .strict(),
    sources: z
      .object({
        mode: z.enum(["off", "requested", "required", "automatic_for_external_claims"]),
        provider: z.literal("openai_web_search"),
        defaultPolicy: policySchema.shape.sourcePolicy,
        previewRequired: z.boolean().default(true),
        maximumClaimsPerRun: z.number().int().positive().max(100).default(10),
        maximumSearchQueriesPerClaim: z.number().int().positive().max(10).default(3),
        minimumSourceCount: z.number().int().positive().default(1),
        storeSourceMetadata: z.boolean().default(true),
        storeResearchNarrative: z.boolean().default(true),
        storeFullPageContent: z.literal(false).default(false),
        policies: z.record(z.string(), policySchema).default({}),
      })
      .strict(),
    gate: z
      .object({
        failOnUnsupportedRequiredCriterion: z.boolean(),
        failOnContradictedRequiredCriterion: z.boolean(),
        failOnRequiredCommandFailure: z.boolean(),
        failOnCriticalFinding: z.boolean(),
        external: z
          .object({
            failOnRequiredSourceError: z.boolean(),
            failOnRequiredExternalContradiction: z.boolean(),
            manualReviewOnConflictingSources: z.boolean(),
            requireBothDomainsForHybridClaims: z.literal(true),
          })
          .strict(),
      })
      .strict(),
    privacy: z.object({ excludedPaths: z.array(z.string()).default([]) }).strict(),
    report: z
      .object({
        outputDirectory: z.string().min(1),
        showClickableSources: z.literal(true),
        showSearchQueries: z.boolean(),
        showSourcePolicy: z.boolean(),
        includeRawCommandOutput: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();

export type EvidenceGateConfig = z.infer<typeof evidenceGateConfigSchema>;

export function parseConfig(value: unknown): EvidenceGateConfig {
  return evidenceGateConfigSchema.parse(value);
}

export function loadConfig(
  repositoryPath = process.cwd(),
  fileName = ".evidencegate.yml",
): EvidenceGateConfig {
  const configPath = path.resolve(repositoryPath, fileName);
  return parseConfig(parse(readFileSync(configPath, "utf8")) as unknown);
}

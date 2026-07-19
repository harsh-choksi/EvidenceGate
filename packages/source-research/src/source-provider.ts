import { assertValidSourceRegistry } from "./citation-validator.js";
import { detectSourceConflicts } from "./conflict-detector.js";
import { buildSourceRegistry } from "./source-registry.js";
import type { ResearchRunMetadata, SourceResearchResult, SourceSearchPlan } from "./types.js";

export interface ParseCachedResponseOptions {
  retrievedAt?: Date;
  model?: string;
  researchRunId?: string;
  strict?: boolean;
}

function stableRunId(
  plan: SourceSearchPlan,
  responseId: string | undefined,
  startedAt: string,
): string {
  const value = `${plan.criterionId}\u0000${responseId ?? "cached"}\u0000${startedAt}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `research-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function researchStatusForRegistry(
  valid: boolean,
  sourceCount: number,
): ResearchRunMetadata["status"] {
  if (valid) return "completed";
  return sourceCount === 0 ? "failed" : "partial";
}

export function parseCachedOpenAIResearchResponse(
  response: unknown,
  plan: SourceSearchPlan,
  options: ParseCachedResponseOptions = {},
): SourceResearchResult {
  const retrievedAt = options.retrievedAt ?? new Date();
  const startedAt = retrievedAt.toISOString();
  const built = buildSourceRegistry(response, plan, retrievedAt);
  if (options.strict ?? false) {
    assertValidSourceRegistry(built.registry);
  }

  const metadata: ResearchRunMetadata = {
    researchRunId: options.researchRunId ?? stableRunId(plan, built.responseId, startedAt),
    criterionIds: [plan.criterionId],
    model: options.model ?? "cached-openai-response",
    webSearchCallIds: built.webSearchCallIds,
    queries: plan.queries.map((query) => query.query),
    allowedDomains: [...plan.allowedDomains],
    blockedDomains: [...plan.blockedDomains],
    startedAt,
    completedAt: retrievedAt.toISOString(),
    sourceCount: built.registry.sources.length,
    citationCount: built.registry.citations.length,
    status: researchStatusForRegistry(built.registry.valid, built.registry.sources.length),
  };

  return {
    narrative: built.narrative,
    registry: built.registry,
    conflicts: detectSourceConflicts(built.registry.sources),
    metadata,
    ...(built.responseId === undefined ? {} : { rawResponseId: built.responseId }),
  };
}

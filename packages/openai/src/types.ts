import type { z } from "zod";

import type {
  AdjudicationInputSchema,
  AdjudicationOutputSchema,
  CombinedClaimAssessmentSchema,
  ExternalClaimAssessmentSchema,
  InternalClaimAssessmentSchema,
} from "./schemas.js";

export type AdjudicationInput = z.input<typeof AdjudicationInputSchema>;
export type NormalizedAdjudicationInput = z.output<typeof AdjudicationInputSchema>;
export type InternalClaimAssessment = z.infer<typeof InternalClaimAssessmentSchema>;
export type ExternalClaimAssessment = z.infer<typeof ExternalClaimAssessmentSchema>;
export type CombinedClaimAssessment = z.infer<typeof CombinedClaimAssessmentSchema>;
export type AdjudicationOutput = z.infer<typeof AdjudicationOutputSchema>;

export interface AdjudicationRunOptions {
  signal?: AbortSignal;
}

export interface EvidenceAdjudicator {
  readonly name: string;
  adjudicate(
    input: AdjudicationInput,
    options?: AdjudicationRunOptions,
  ): Promise<AdjudicationOutput>;
}

export const SOURCE_POLICY_NAMES = [
  "official_only",
  "primary_sources",
  "standards_bodies",
  "vendor_documentation",
  "maintainer_sources",
  "peer_reviewed",
  "government_sources",
  "reputable_broad",
  "custom",
] as const;

export type SourcePolicyName = (typeof SOURCE_POLICY_NAMES)[number];

export const SOURCE_TYPES = [
  "official_documentation",
  "standard",
  "government",
  "maintainer_release",
  "package_registry",
  "peer_reviewed",
  "official_repository",
  "reputable_secondary",
  "community",
  "unknown",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export interface DomainRule {
  hostname: string;
  includeSubdomains: boolean;
}

export interface SourcePolicyConfig {
  name: SourcePolicyName;
  allowedDomains: string[];
  blockedDomains: string[];
  allowedDomainRules: DomainRule[];
  blockedDomainRules: DomainRule[];
  minimumSourceCount: number;
  maxSourceAgeDays: number | null;
  requiredSourceTypes: SourceType[];
  jurisdiction?: string;
  language?: string;
}

export interface SourceAuthority {
  sourceType: SourceType;
  isPrimary: boolean;
  isOfficial: boolean;
  isCurrent: boolean | null;
  publisherMatch: boolean | null;
  domainAllowed: boolean;
  conflictsWithOtherSources: boolean;
  limitations: string[];
}

export interface SearchQuery {
  query: string;
  purpose: string;
  warnings: string[];
}

export interface SourceSearchPlan {
  criterionId: string;
  normalizedExternalClaim: string;
  queries: SearchQuery[];
  sourcePolicy: SourcePolicyConfig;
  allowedDomains: string[];
  blockedDomains: string[];
  maxSourceAgeDays: number | null;
  minimumSourceCount: number;
  rationale: string;
  requiresUserApproval: boolean;
  privacyWarnings: string[];
}

export interface CitationAnnotation {
  citationId: string;
  sourceId: string;
  startIndex?: number;
  endIndex?: number;
  citedText?: string;
}

export type FreshnessStatus = "current" | "possibly_stale" | "stale" | "unknown";

export interface ExternalSourceRecord {
  sourceId: string;
  webSearchCallId: string;
  webSearchCallIds?: string[];
  url: string;
  normalizedUrl: string;
  title: string;
  domain: string;
  publisher?: string;
  publishedAt?: string;
  updatedAt?: string;
  retrievedAt: string;
  sourceType: SourceType;
  isPrimary: boolean;
  isOfficial: boolean;
  allowedByPolicy: boolean;
  freshnessStatus: FreshnessStatus;
  contentHash?: string;
  citationAnnotations: CitationAnnotation[];
  claimsSupported: string[];
  claimsContradicted: string[];
  limitations: string[];
}

export type CitationIntegrityIssueCode =
  | "invalid_response_shape"
  | "missing_source_url"
  | "unsafe_source_url"
  | "blocked_source_domain"
  | "disallowed_source_domain"
  | "redirect_domain_bypass"
  | "invalid_annotation_range"
  | "missing_citation_annotations"
  | "unsupported_citation_url"
  | "verified_citation_url_alias"
  | "invalid_citation_url"
  | "duplicate_source_metadata"
  | "source_count_below_minimum";

export interface CitationIntegrityIssue {
  code: CitationIntegrityIssueCode;
  message: string;
  fatal: boolean;
  sourceUrl?: string;
  citationIndex?: number;
}

export interface SourceRegistry {
  sources: ExternalSourceRecord[];
  citations: CitationAnnotation[];
  issues: CitationIntegrityIssue[];
  valid: boolean;
}

export interface SourceConflict {
  conflictId: string;
  normalizedClaim: string;
  supportingSourceIds: string[];
  contradictingSourceIds: string[];
  reason: string;
  requiresManualReview: boolean;
}

export interface ResearchRunMetadata {
  researchRunId: string;
  criterionIds: string[];
  model: string;
  webSearchCallIds: string[];
  queries: string[];
  allowedDomains: string[];
  blockedDomains: string[];
  startedAt: string;
  completedAt: string;
  sourceCount: number;
  citationCount: number;
  status: "completed" | "partial" | "failed" | "cancelled";
}

export interface SourceResearchResult {
  narrative: string;
  registry: SourceRegistry;
  conflicts: SourceConflict[];
  metadata: ResearchRunMetadata;
  rawResponseId?: string;
}

export interface SourceResearchOptions {
  approved: boolean;
  retrievedAt?: Date;
  signal?: AbortSignal;
}

export interface SourceProvider {
  readonly name: string;
  research(plan: SourceSearchPlan, options: SourceResearchOptions): Promise<SourceResearchResult>;
}

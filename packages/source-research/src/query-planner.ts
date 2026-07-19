import {
  createOpenAIOfficialSourcePolicy,
  createSourcePolicy,
  type SourcePolicyOverrides,
} from "./source-policy.js";
import { detectQueryPrivacyWarnings, redactSensitiveText } from "./redaction.js";
import type {
  SearchQuery,
  SourcePolicyConfig,
  SourcePolicyName,
  SourceSearchPlan,
} from "./types.js";

export interface SourceSearchPlanInput {
  criterionId: string;
  externalClaim: string;
  productOrStandard?: string;
  version?: string;
  dateSensitivity?: string;
  sourcePolicy?: SourcePolicyConfig;
  sourcePolicyName?: SourcePolicyName;
  sourcePolicyOverrides?: SourcePolicyOverrides;
  privateIdentifiers?: readonly string[];
  requireUserApproval?: boolean;
}

function normalizeComponent(value: string | undefined, maximumLength: number): string {
  if (value === undefined) return "";
  return redactSensitiveText(value, {
    redactEmails: true,
    redactCodeBlocks: true,
    maximumLength,
  }).text;
}

function isOpenAIProduct(value: string): boolean {
  return /\b(?:openai|chatgpt|codex|responses api|gpt-)\b/iu.test(value);
}

function choosePolicy(input: SourceSearchPlanInput): SourcePolicyConfig {
  if (input.sourcePolicy !== undefined) return input.sourcePolicy;

  const combined = `${input.productOrStandard ?? ""} ${input.externalClaim}`;
  if (isOpenAIProduct(combined)) {
    return createOpenAIOfficialSourcePolicy(input.sourcePolicyOverrides);
  }
  return createSourcePolicy(
    input.sourcePolicyName ?? "primary_sources",
    input.sourcePolicyOverrides,
  );
}

function policySearchQualifier(policy: SourcePolicyConfig): string {
  switch (policy.name) {
    case "official_only":
    case "vendor_documentation":
      return "official documentation";
    case "standards_bodies":
      return "official standard specification";
    case "maintainer_sources":
      return "maintainer documentation release notes";
    case "peer_reviewed":
      return "peer reviewed original research";
    case "government_sources":
      return "official government publication";
    case "primary_sources":
      return "primary source";
    case "reputable_broad":
      return "authoritative sources";
    case "custom":
      return "source verification";
  }
}

function uniqueParts(parts: readonly string[]): string[] {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const normalized = part.trim().toLocaleLowerCase();
    if (normalized === "" || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function createSourceSearchPlan(input: SourceSearchPlanInput): SourceSearchPlan {
  if (input.criterionId.trim() === "") {
    throw new Error("criterionId is required.");
  }

  const claimRedaction = redactSensitiveText(input.externalClaim, {
    redactEmails: true,
    redactCodeBlocks: true,
    maximumLength: 600,
  });
  if (claimRedaction.text === "") {
    throw new Error("externalClaim is empty after privacy redaction.");
  }

  const product = normalizeComponent(input.productOrStandard, 100);
  const version = normalizeComponent(input.version, 60);
  const dateSensitivity = normalizeComponent(input.dateSensitivity, 80);
  const policy = choosePolicy(input);
  const qualifier = policySearchQualifier(policy);

  const baseQuery = uniqueParts([
    product,
    claimRedaction.text,
    version === "" ? "" : `version ${version}`,
    dateSensitivity,
    qualifier,
  ]).join(" ");

  const queryWarnings = detectQueryPrivacyWarnings(baseQuery, {
    ...(input.privateIdentifiers === undefined
      ? {}
      : { privateIdentifiers: input.privateIdentifiers }),
  });
  const sanitizedQuery = redactSensitiveText(baseQuery, {
    redactEmails: true,
    redactCodeBlocks: true,
    maximumLength: 500,
  }).text;

  const queries: SearchQuery[] = [
    {
      query: sanitizedQuery,
      purpose: "Verify the normalized external claim against the configured source policy.",
      warnings: queryWarnings,
    },
  ];
  const privacyWarnings = [
    ...new Set([
      ...claimRedaction.findings.map(
        (finding) => `Removed ${finding.kind.replaceAll("_", " ")} from the search preview.`,
      ),
      ...queryWarnings,
    ]),
  ];

  return {
    criterionId: input.criterionId.trim(),
    normalizedExternalClaim: claimRedaction.text,
    queries,
    sourcePolicy: policy,
    allowedDomains: [...policy.allowedDomains],
    blockedDomains: [...policy.blockedDomains],
    maxSourceAgeDays: policy.maxSourceAgeDays,
    minimumSourceCount: policy.minimumSourceCount,
    rationale:
      "External verification is limited to the claim, product/version context, freshness need, and configured source restrictions; repository code is excluded.",
    requiresUserApproval: input.requireUserApproval ?? true,
    privacyWarnings,
  };
}

export class SearchPlanApprovalError extends Error {
  public constructor() {
    super("This source-search plan requires explicit user approval before a live request.");
    this.name = "SearchPlanApprovalError";
  }
}

export function assertSearchPlanApproved(plan: SourceSearchPlan, approved: boolean): void {
  if (plan.requiresUserApproval && !approved) {
    throw new SearchPlanApprovalError();
  }
}

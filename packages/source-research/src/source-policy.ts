import { createDomainRule, createDomainRules, evaluateDomainPolicy } from "./domain-policy.js";
import { normalizeSourceUrl } from "./url-validator.js";
import type {
  DomainRule,
  ExternalSourceRecord,
  FreshnessStatus,
  SourceAuthority,
  SourcePolicyConfig,
  SourcePolicyName,
  SourceType,
} from "./types.js";

export const OPENAI_OFFICIAL_DOCUMENTATION_DOMAINS = [
  "developers.openai.com",
  "platform.openai.com",
] as const;

const PRIMARY_SOURCE_TYPES: SourceType[] = [
  "official_documentation",
  "standard",
  "government",
  "maintainer_release",
  "package_registry",
  "peer_reviewed",
  "official_repository",
];

interface PolicyPreset {
  minimumSourceCount: number;
  maxSourceAgeDays: number | null;
  requiredSourceTypes: SourceType[];
}

const POLICY_PRESETS: Record<SourcePolicyName, PolicyPreset> = {
  official_only: {
    minimumSourceCount: 1,
    maxSourceAgeDays: 30,
    requiredSourceTypes: ["official_documentation"],
  },
  primary_sources: {
    minimumSourceCount: 1,
    maxSourceAgeDays: 90,
    requiredSourceTypes: PRIMARY_SOURCE_TYPES,
  },
  standards_bodies: {
    minimumSourceCount: 1,
    maxSourceAgeDays: 365,
    requiredSourceTypes: ["standard"],
  },
  vendor_documentation: {
    minimumSourceCount: 1,
    maxSourceAgeDays: 30,
    requiredSourceTypes: ["official_documentation", "maintainer_release"],
  },
  maintainer_sources: {
    minimumSourceCount: 1,
    maxSourceAgeDays: 90,
    requiredSourceTypes: [
      "maintainer_release",
      "official_documentation",
      "official_repository",
      "package_registry",
    ],
  },
  peer_reviewed: {
    minimumSourceCount: 1,
    maxSourceAgeDays: 730,
    requiredSourceTypes: ["peer_reviewed"],
  },
  government_sources: {
    minimumSourceCount: 1,
    maxSourceAgeDays: 30,
    requiredSourceTypes: ["government"],
  },
  reputable_broad: {
    minimumSourceCount: 2,
    maxSourceAgeDays: 365,
    requiredSourceTypes: [...PRIMARY_SOURCE_TYPES, "reputable_secondary"],
  },
  custom: {
    minimumSourceCount: 1,
    maxSourceAgeDays: null,
    requiredSourceTypes: [],
  },
};

export interface SourcePolicyOverrides {
  allowedDomains?: readonly (string | DomainRule)[];
  blockedDomains?: readonly (string | DomainRule)[];
  includeAllowedSubdomains?: boolean;
  minimumSourceCount?: number;
  maxSourceAgeDays?: number | null;
  requiredSourceTypes?: readonly SourceType[];
  jurisdiction?: string;
  language?: string;
}

function validateNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

export function createSourcePolicy(
  name: SourcePolicyName,
  overrides: SourcePolicyOverrides = {},
): SourcePolicyConfig {
  const preset = POLICY_PRESETS[name];
  const allowedDomainRules = createDomainRules(
    overrides.allowedDomains ?? [],
    overrides.includeAllowedSubdomains ?? false,
  );
  // Blocking a base domain blocks its subdomains unless explicitly represented
  // by a narrower rule. This is the safe default for deny lists.
  const blockedDomainRules = createDomainRules(overrides.blockedDomains ?? [], true);

  const minimumSourceCount = validateNonNegativeInteger(
    overrides.minimumSourceCount ?? preset.minimumSourceCount,
    "minimumSourceCount",
  );
  const maxSourceAgeDays =
    overrides.maxSourceAgeDays === undefined ? preset.maxSourceAgeDays : overrides.maxSourceAgeDays;
  if (maxSourceAgeDays !== null && (!Number.isFinite(maxSourceAgeDays) || maxSourceAgeDays < 0)) {
    throw new RangeError("maxSourceAgeDays must be null or a non-negative number.");
  }

  const requiredSourceTypes = [
    ...new Set(overrides.requiredSourceTypes ?? preset.requiredSourceTypes),
  ];

  return {
    name,
    allowedDomains: [...new Set(allowedDomainRules.map((rule) => rule.hostname))],
    blockedDomains: [...new Set(blockedDomainRules.map((rule) => rule.hostname))],
    allowedDomainRules,
    blockedDomainRules,
    minimumSourceCount,
    maxSourceAgeDays,
    requiredSourceTypes,
    ...(overrides.jurisdiction === undefined ? {} : { jurisdiction: overrides.jurisdiction }),
    ...(overrides.language === undefined ? {} : { language: overrides.language }),
  };
}

export function createOpenAIOfficialSourcePolicy(
  overrides: Omit<SourcePolicyOverrides, "allowedDomains"> & {
    allowedDomains?: readonly (string | DomainRule)[];
  } = {},
): SourcePolicyConfig {
  return createSourcePolicy("official_only", {
    ...overrides,
    allowedDomains: overrides.allowedDomains ?? OPENAI_OFFICIAL_DOCUMENTATION_DOMAINS,
  });
}

const KNOWN_DOMAIN_TYPES: readonly (readonly [DomainRule, SourceType])[] = [
  ...[
    "w3.org",
    "ietf.org",
    "rfc-editor.org",
    "owasp.org",
    "nist.gov",
    "iso.org",
    "ecma-international.org",
    "whatwg.org",
  ].map((hostname) => [createDomainRule(hostname, true), "standard"] as const),
  ...["npmjs.com", "pypi.org", "crates.io", "nuget.org"].map(
    (hostname) => [createDomainRule(hostname, true), "package_registry"] as const,
  ),
];

export interface ClassifySourceAuthorityInput {
  url: string;
  policy: SourcePolicyConfig;
  declaredSourceType?: SourceType;
  publisherMatch?: boolean | null;
  freshnessStatus?: FreshnessStatus;
  conflictsWithOtherSources?: boolean;
}

export function classifySourceAuthority(input: ClassifySourceAuthorityInput): SourceAuthority {
  const parsed = normalizeSourceUrl(input.url);
  if (!parsed.valid) {
    return {
      sourceType: "unknown",
      isPrimary: false,
      isOfficial: false,
      isCurrent: null,
      publisherMatch: input.publisherMatch ?? null,
      domainAllowed: false,
      conflictsWithOtherSources: input.conflictsWithOtherSources ?? false,
      limitations: [parsed.message],
    };
  }

  const decision = evaluateDomainPolicy(
    parsed.hostname,
    input.policy.allowedDomainRules,
    input.policy.blockedDomainRules,
  );
  const knownType = KNOWN_DOMAIN_TYPES.find(
    ([rule]) => evaluateDomainPolicy(parsed.hostname, [rule], []).allowed,
  )?.[1];
  const governmentBySuffix =
    parsed.hostname.endsWith(".gov") || parsed.hostname.endsWith(".gov.uk");
  const sourceType =
    input.declaredSourceType ??
    knownType ??
    (governmentBySuffix ? "government" : undefined) ??
    (decision.allowed &&
    (input.policy.name === "official_only" || input.policy.name === "vendor_documentation")
      ? "official_documentation"
      : "unknown");

  const policyAuthorizesOfficialDomain =
    decision.allowed &&
    (input.policy.name === "official_only" || input.policy.name === "vendor_documentation");
  const recognizedOfficialPublisher =
    decision.allowed &&
    (knownType === "standard" || governmentBySuffix || input.publisherMatch === true);
  const isOfficial = policyAuthorizesOfficialDomain || recognizedOfficialPublisher;
  const isPrimary = PRIMARY_SOURCE_TYPES.includes(sourceType);
  const isCurrent =
    input.freshnessStatus === undefined || input.freshnessStatus === "unknown"
      ? null
      : input.freshnessStatus === "current";

  const limitations: string[] = [];
  if (!decision.allowed) {
    limitations.push(
      decision.blocked
        ? "Domain is blocked by source policy."
        : "Domain is not allowed by source policy.",
    );
  }
  if (sourceType === "unknown") {
    limitations.push("Source authority type could not be established.");
  }
  if (input.freshnessStatus === "stale") {
    limitations.push("Source exceeds the configured freshness limit.");
  } else if (input.freshnessStatus === "possibly_stale") {
    limitations.push("Source is near or beyond the configured freshness limit.");
  } else if (input.freshnessStatus === "unknown") {
    limitations.push("Source publication freshness is unknown.");
  }

  return {
    sourceType,
    isPrimary,
    isOfficial,
    isCurrent,
    publisherMatch: input.publisherMatch ?? null,
    domainAllowed: decision.allowed,
    conflictsWithOtherSources: input.conflictsWithOtherSources ?? false,
    limitations,
  };
}

export interface SourcePolicyEvaluation {
  accepted: boolean;
  reasons: string[];
}

export function evaluateSourceAgainstPolicy(
  source: ExternalSourceRecord,
  policy: SourcePolicyConfig,
): SourcePolicyEvaluation {
  const reasons: string[] = [];
  const decision = evaluateDomainPolicy(
    source.domain,
    policy.allowedDomainRules,
    policy.blockedDomainRules,
  );
  if (!decision.allowed) {
    reasons.push(
      decision.blocked
        ? `Blocked source domain: ${source.domain}`
        : `Source domain is not allowlisted: ${source.domain}`,
    );
  }
  if (
    policy.requiredSourceTypes.length > 0 &&
    !policy.requiredSourceTypes.includes(source.sourceType)
  ) {
    reasons.push(`Source type ${source.sourceType} is not accepted by this policy.`);
  }
  if (policy.name === "official_only" && !source.isOfficial) {
    reasons.push("Official-only policy requires an authorized official source.");
  }
  if (source.freshnessStatus === "stale") {
    reasons.push("Source is stale under the configured freshness limit.");
  }

  return { accepted: reasons.length === 0, reasons };
}

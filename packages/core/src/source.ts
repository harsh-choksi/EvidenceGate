import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  NonEmptyTextSchema,
  Sha256Schema,
  addDuplicateIssues,
  uniqueStringsSchema,
} from "./common.js";

export const SourceModeSchema = z.enum([
  "off",
  "requested",
  "required",
  "automatic_for_external_claims",
]);
export type SourceMode = z.infer<typeof SourceModeSchema>;

export const SourcePolicySchema = z.enum([
  "official_only",
  "primary_sources",
  "standards_bodies",
  "vendor_documentation",
  "maintainer_sources",
  "peer_reviewed",
  "government_sources",
  "reputable_broad",
  "custom",
]);
export type SourcePolicy = z.infer<typeof SourcePolicySchema>;

export const SourceTypeSchema = z.enum([
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
]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const FreshnessStatusSchema = z.enum(["current", "possibly_stale", "stale", "unknown"]);
export type FreshnessStatus = z.infer<typeof FreshnessStatusSchema>;

export const HostnameSchema = z
  .string()
  .trim()
  .min(1)
  .superRefine((value, context) => {
    if (value !== value.toLowerCase()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hostname must be lowercase",
      });
    }

    try {
      const parsed = new URL(`https://${value}`);
      if (parsed.hostname !== value || parsed.username || parsed.password || parsed.port) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Expected an exact hostname without credentials, a port, path, or wildcard",
        });
      }
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid hostname" });
    }
  });

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

export const HttpUrlSchema = z.string().url().refine(isHttpUrl, {
  message: "Only HTTP and HTTPS URLs without embedded credentials are allowed",
});

const TRACKING_PARAMETER_NAMES = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
]);

export function normalizeSourceUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("Only HTTP and HTTPS URLs can be normalized");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new TypeError("Source URLs with embedded credentials cannot be normalized");
  }

  parsed.hash = "";

  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETER_NAMES.has(key.toLowerCase())) {
      parsed.searchParams.delete(key);
    }
  }

  parsed.searchParams.sort();
  return parsed.toString();
}

export function hostnameMatches(
  hostname: string,
  allowedHostname: string,
  includeSubdomains = false,
): boolean {
  const candidate = hostname.toLowerCase().replace(/\.$/, "");
  const allowed = allowedHostname.toLowerCase().replace(/\.$/, "");
  return candidate === allowed || (includeSubdomains && candidate.endsWith(`.${allowed}`));
}

export const SourceAuthoritySchema = z
  .object({
    sourceType: SourceTypeSchema,
    isPrimary: z.boolean(),
    isOfficial: z.boolean(),
    isCurrent: z.boolean().nullable(),
    publisherMatch: z.boolean().nullable(),
    domainAllowed: z.boolean(),
    conflictsWithOtherSources: z.boolean(),
    limitations: uniqueStringsSchema(),
  })
  .strict();
export type SourceAuthority = z.infer<typeof SourceAuthoritySchema>;

export const CitationAnnotationSchema = z
  .object({
    citationId: IdentifierSchema,
    sourceId: IdentifierSchema,
    startIndex: z.number().int().nonnegative().optional(),
    endIndex: z.number().int().positive().optional(),
    citedText: NonEmptyTextSchema.optional(),
  })
  .strict()
  .superRefine((citation, context) => {
    const hasStart = citation.startIndex !== undefined;
    const hasEnd = citation.endIndex !== undefined;

    if (hasStart !== hasEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Citation startIndex and endIndex must be provided together",
        path: hasStart ? ["endIndex"] : ["startIndex"],
      });
    }

    if (
      citation.startIndex !== undefined &&
      citation.endIndex !== undefined &&
      citation.endIndex <= citation.startIndex
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Citation endIndex must be greater than startIndex",
        path: ["endIndex"],
      });
    }
  });
export type CitationAnnotation = z.infer<typeof CitationAnnotationSchema>;

export const ExternalSourceRecordSchema = z
  .object({
    sourceId: IdentifierSchema,
    webSearchCallId: IdentifierSchema,
    webSearchCallIds: z.array(IdentifierSchema).optional(),
    url: HttpUrlSchema,
    normalizedUrl: HttpUrlSchema,
    title: NonEmptyTextSchema,
    domain: HostnameSchema,
    publisher: NonEmptyTextSchema.optional(),
    publishedAt: IsoDateTimeSchema.optional(),
    retrievedAt: IsoDateTimeSchema,
    sourceType: SourceTypeSchema,
    isPrimary: z.boolean(),
    isOfficial: z.boolean(),
    allowedByPolicy: z.boolean(),
    freshnessStatus: FreshnessStatusSchema,
    contentHash: Sha256Schema.optional(),
    citationAnnotations: z.array(CitationAnnotationSchema),
    claimsSupported: uniqueStringsSchema(),
    claimsContradicted: uniqueStringsSchema(),
    limitations: uniqueStringsSchema(),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.webSearchCallIds !== undefined) {
      addDuplicateIssues(
        source.webSearchCallIds,
        context,
        ["webSearchCallIds"],
        "web-search call ID",
      );
      if (!source.webSearchCallIds.includes(source.webSearchCallId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "webSearchCallIds must include webSearchCallId",
          path: ["webSearchCallIds"],
        });
      }
    }

    let normalizedHostname: string | undefined;
    try {
      normalizedHostname = new URL(source.normalizedUrl).hostname;
    } catch {
      // HttpUrlSchema reports the primary URL issue.
    }

    if (normalizedHostname !== undefined && source.domain !== normalizedHostname) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "domain must exactly match normalizedUrl hostname",
        path: ["domain"],
      });
    }

    addDuplicateIssues(
      source.citationAnnotations.map((citation) => citation.citationId),
      context,
      ["citationAnnotations"],
      "citation ID",
    );

    source.citationAnnotations.forEach((citation, index) => {
      if (citation.sourceId !== source.sourceId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Citation ${citation.citationId} does not bind to its containing source`,
          path: ["citationAnnotations", index, "sourceId"],
        });
      }
    });
  });
export type ExternalSourceRecord = z.infer<typeof ExternalSourceRecordSchema>;

export const SearchQuerySchema = z
  .object({
    query: NonEmptyTextSchema,
    rationale: NonEmptyTextSchema.optional(),
  })
  .strict();
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SourceSearchPlanSchema = z
  .object({
    criterionId: IdentifierSchema,
    normalizedExternalClaim: NonEmptyTextSchema,
    queries: z.array(SearchQuerySchema).min(1),
    sourcePolicy: SourcePolicySchema,
    allowedDomains: z.array(HostnameSchema),
    blockedDomains: z.array(HostnameSchema),
    maxSourceAgeDays: z.number().int().nonnegative().nullable(),
    minimumSourceCount: z.number().int().positive(),
    rationale: NonEmptyTextSchema,
    requiresUserApproval: z.boolean(),
  })
  .strict()
  .superRefine((plan, context) => {
    addDuplicateIssues(plan.allowedDomains, context, ["allowedDomains"], "allowed domain");
    addDuplicateIssues(plan.blockedDomains, context, ["blockedDomains"], "blocked domain");

    const blocked = new Set(plan.blockedDomains);
    plan.allowedDomains.forEach((domain, index) => {
      if (blocked.has(domain)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Domain cannot be both allowed and blocked: ${domain}`,
          path: ["allowedDomains", index],
        });
      }
    });
  });
export type SourceSearchPlan = z.infer<typeof SourceSearchPlanSchema>;

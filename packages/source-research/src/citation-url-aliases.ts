export interface VerifiedCitationUrlAlias {
  ruleId: string;
  urls: readonly [string, string];
}

const VERIFIED_CITATION_URL_ALIASES: readonly VerifiedCitationUrlAlias[] = [
  {
    ruleId: "openai-web-search-guide-legacy-url-v1",
    urls: [
      "https://platform.openai.com/docs/guides/tools-web-search",
      "https://developers.openai.com/api/docs/guides/tools-web-search",
    ],
  },
];

/**
 * Returns an audited equivalence rule for two already-normalized URLs.
 * Exact matching remains the primary binding path; this function never
 * performs network access, follows redirects, or creates a source record.
 */
export function findVerifiedCitationUrlAlias(
  leftNormalizedUrl: string,
  rightNormalizedUrl: string,
): VerifiedCitationUrlAlias | undefined {
  if (leftNormalizedUrl === rightNormalizedUrl) return undefined;
  return VERIFIED_CITATION_URL_ALIASES.find(
    (rule) =>
      rule.urls.some((url) => url === leftNormalizedUrl) &&
      rule.urls.some((url) => url === rightNormalizedUrl),
  );
}

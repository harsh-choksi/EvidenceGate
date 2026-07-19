import { evaluateDomainPolicy } from "./domain-policy.js";
import type { DomainRule } from "./types.js";

const TRACKING_PARAMETER_NAMES = new Set([
  "dclid",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "_ga",
  "_gl",
]);

const REDIRECT_PARAMETER_NAMES = new Set([
  "continue",
  "dest",
  "destination",
  "next",
  "redirect",
  "redirect_to",
  "redirect_uri",
  "redirect_url",
  "return",
  "return_to",
  "target",
  "url",
]);

export type UrlValidationErrorCode =
  | "empty_url"
  | "invalid_url"
  | "unsupported_scheme"
  | "embedded_credentials"
  | "blocked_domain"
  | "disallowed_domain"
  | "redirect_domain_bypass";

export type UrlValidationResult =
  | {
      valid: true;
      url: string;
      normalizedUrl: string;
      hostname: string;
      scheme: "http:" | "https:";
    }
  | {
      valid: false;
      code: UrlValidationErrorCode;
      message: string;
    };

function isTrackingParameter(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.startsWith("utm_") || TRACKING_PARAMETER_NAMES.has(normalized);
}

function decodePotentialUrl(value: string): string {
  let decoded = value;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.trim();
}

export interface RedirectTarget {
  parameter: string;
  target: URL;
}

export function findAbsoluteRedirectTargets(url: URL): RedirectTarget[] {
  const targets: RedirectTarget[] = [];
  for (const [name, value] of url.searchParams) {
    if (!REDIRECT_PARAMETER_NAMES.has(name.toLowerCase())) {
      continue;
    }

    const decoded = decodePotentialUrl(value);
    if (!/^https?:\/\//iu.test(decoded)) {
      continue;
    }

    try {
      targets.push({ parameter: name, target: new URL(decoded) });
    } catch {
      continue;
    }
  }
  return targets;
}

export function findAbsoluteRedirectTarget(url: URL): RedirectTarget | undefined {
  return findAbsoluteRedirectTargets(url)[0];
}

export function normalizeSourceUrl(input: string): UrlValidationResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { valid: false, code: "empty_url", message: "URL cannot be empty." };
  }

  if (/\p{Cc}/u.test(trimmed)) {
    return {
      valid: false,
      code: "invalid_url",
      message: "URL contains control characters.",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, code: "invalid_url", message: `Invalid URL: ${input}` };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      valid: false,
      code: "unsupported_scheme",
      message: `Only HTTP and HTTPS URLs are allowed; received ${parsed.protocol}`,
    };
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return {
      valid: false,
      code: "embedded_credentials",
      message: "Source URLs cannot contain embedded credentials.",
    };
  }

  parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  if (
    (parsed.protocol === "https:" && parsed.port === "443") ||
    (parsed.protocol === "http:" && parsed.port === "80")
  ) {
    parsed.port = "";
  }
  parsed.hash = "";

  for (const name of [...parsed.searchParams.keys()]) {
    if (isTrackingParameter(name)) {
      parsed.searchParams.delete(name);
    }
  }
  parsed.searchParams.sort();

  return {
    valid: true,
    url: trimmed,
    normalizedUrl: parsed.toString(),
    hostname: parsed.hostname,
    scheme: parsed.protocol,
  };
}

export function validateSourceUrl(
  input: string,
  allowedRules: readonly DomainRule[],
  blockedRules: readonly DomainRule[],
): UrlValidationResult {
  const normalized = normalizeSourceUrl(input);
  if (!normalized.valid) {
    return normalized;
  }

  const decision = evaluateDomainPolicy(normalized.hostname, allowedRules, blockedRules);
  if (decision.blocked) {
    return {
      valid: false,
      code: "blocked_domain",
      message: `Source hostname is blocked: ${normalized.hostname}`,
    };
  }
  if (!decision.allowed) {
    return {
      valid: false,
      code: "disallowed_domain",
      message: `Source hostname is not allowlisted: ${normalized.hostname}`,
    };
  }

  const parsed = new URL(normalized.normalizedUrl);
  for (const redirect of findAbsoluteRedirectTargets(parsed)) {
    const redirectDecision = evaluateDomainPolicy(
      redirect.target.hostname,
      allowedRules,
      blockedRules,
    );
    if (!redirectDecision.allowed || redirectDecision.blocked) {
      return {
        valid: false,
        code: "redirect_domain_bypass",
        message: `Redirect-like parameter ${redirect.parameter} points outside the source policy.`,
      };
    }
  }

  return normalized;
}

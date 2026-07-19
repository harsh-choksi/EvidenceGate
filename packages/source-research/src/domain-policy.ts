import type { DomainRule } from "./types.js";

export class InvalidDomainRuleError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "InvalidDomainRuleError";
  }
}

function parseHostname(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) {
    throw new InvalidDomainRuleError("Domain rules cannot be empty.");
  }

  if (/[/\\?#@\s]/u.test(trimmed)) {
    throw new InvalidDomainRuleError(`Domain rule must be a hostname, not a URL or path: ${value}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(`http://${trimmed}`);
  } catch {
    throw new InvalidDomainRuleError(`Invalid hostname: ${value}`);
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  if (hostname.length === 0 || parsed.port !== "") {
    throw new InvalidDomainRuleError(`Invalid hostname: ${value}`);
  }

  if (
    !hostname.startsWith("[") &&
    hostname
      .split(".")
      .some(
        (label) =>
          label.length === 0 ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
      )
  ) {
    throw new InvalidDomainRuleError(`Invalid hostname: ${value}`);
  }

  return hostname;
}

export function normalizeHostname(value: string): string {
  return parseHostname(value);
}

export function createDomainRule(
  value: string | DomainRule,
  defaultIncludeSubdomains = false,
): DomainRule {
  if (typeof value !== "string") {
    return {
      hostname: parseHostname(value.hostname),
      includeSubdomains: value.includeSubdomains,
    };
  }

  const trimmed = value.trim();
  const wildcard = trimmed.startsWith("*.");
  const hostname = wildcard ? trimmed.slice(2) : trimmed;
  return {
    hostname: parseHostname(hostname),
    includeSubdomains: wildcard || defaultIncludeSubdomains,
  };
}

export function createDomainRules(
  values: readonly (string | DomainRule)[],
  defaultIncludeSubdomains = false,
): DomainRule[] {
  const seen = new Set<string>();
  const rules: DomainRule[] = [];

  for (const value of values) {
    const rule = createDomainRule(value, defaultIncludeSubdomains);
    const key = `${rule.hostname}:${String(rule.includeSubdomains)}`;
    if (!seen.has(key)) {
      seen.add(key);
      rules.push(rule);
    }
  }

  return rules;
}

export function hostnameMatchesRule(hostnameInput: string, rule: DomainRule): boolean {
  const hostname = parseHostname(hostnameInput);
  return (
    hostname === rule.hostname || (rule.includeSubdomains && hostname.endsWith(`.${rule.hostname}`))
  );
}

export interface DomainPolicyDecision {
  allowed: boolean;
  blocked: boolean;
  hostname: string;
  matchedAllowedRule?: DomainRule;
  matchedBlockedRule?: DomainRule;
  reason: "allowed" | "blocked" | "not_allowlisted" | "unrestricted";
}

export function evaluateDomainPolicy(
  hostnameInput: string,
  allowedRules: readonly DomainRule[],
  blockedRules: readonly DomainRule[],
): DomainPolicyDecision {
  const hostname = parseHostname(hostnameInput);
  const matchedBlockedRule = blockedRules.find((rule) => hostnameMatchesRule(hostname, rule));

  if (matchedBlockedRule !== undefined) {
    return {
      allowed: false,
      blocked: true,
      hostname,
      matchedBlockedRule,
      reason: "blocked",
    };
  }

  if (allowedRules.length === 0) {
    return {
      allowed: true,
      blocked: false,
      hostname,
      reason: "unrestricted",
    };
  }

  const matchedAllowedRule = allowedRules.find((rule) => hostnameMatchesRule(hostname, rule));
  if (matchedAllowedRule === undefined) {
    return {
      allowed: false,
      blocked: false,
      hostname,
      reason: "not_allowlisted",
    };
  }

  return {
    allowed: true,
    blocked: false,
    hostname,
    matchedAllowedRule,
    reason: "allowed",
  };
}

export function domainRulesToApiDomains(rules: readonly DomainRule[]): string[] {
  return [...new Set(rules.map((rule) => rule.hostname))];
}

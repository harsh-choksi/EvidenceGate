import { describe, expect, it } from "vitest";

import {
  createDomainRule,
  createDomainRules,
  evaluateDomainPolicy,
  hostnameMatchesRule,
  normalizeSourceUrl,
  validateSourceUrl,
} from "../src/index.js";

describe("domain policy", () => {
  it("uses exact matching unless subdomains are explicitly enabled", () => {
    const exact = createDomainRule("openai.com");
    const withSubdomains = createDomainRule("*.openai.com");

    expect(hostnameMatchesRule("openai.com", exact)).toBe(true);
    expect(hostnameMatchesRule("developers.openai.com", exact)).toBe(false);
    expect(hostnameMatchesRule("developers.openai.com", withSubdomains)).toBe(true);
    expect(hostnameMatchesRule("openai.com.evil.example", withSubdomains)).toBe(false);
    expect(hostnameMatchesRule("openai-docs.example", withSubdomains)).toBe(false);
  });

  it("gives blocked rules precedence", () => {
    const decision = evaluateDomainPolicy(
      "docs.example.com",
      createDomainRules(["*.example.com"]),
      createDomainRules(["docs.example.com"], true),
    );
    expect(decision).toMatchObject({ allowed: false, blocked: true, reason: "blocked" });
  });
});

describe("URL validation", () => {
  it("normalizes host casing, ports, fragments, query order, and tracking parameters", () => {
    const result = normalizeSourceUrl("https://EXAMPLE.com:443/docs?utm_source=x&b=2&a=1#section");
    expect(result).toMatchObject({
      valid: true,
      normalizedUrl: "https://example.com/docs?a=1&b=2",
      hostname: "example.com",
    });
  });

  it.each(["javascript:alert(1)", "data:text/html,hello", "file:///tmp/a", "ftp://example.com/a"])(
    "rejects unsupported URL scheme %s",
    (url) => {
      expect(normalizeSourceUrl(url)).toMatchObject({
        valid: false,
        code: "unsupported_scheme",
      });
    },
  );

  it("rejects redirect-like domain bypasses", () => {
    const result = validateSourceUrl(
      "https://developers.openai.com/redirect?url=https%3A%2F%2Fevil.example%2Ffake",
      createDomainRules(["developers.openai.com"]),
      [],
    );
    expect(result).toMatchObject({ valid: false, code: "redirect_domain_bypass" });
  });

  it("checks every redirect-like target instead of trusting the first one", () => {
    const result = validateSourceUrl(
      "https://developers.openai.com/redirect?url=https%3A%2F%2Fdevelopers.openai.com%2Fsafe&next=https%3A%2F%2Fevil.example%2Ffake",
      createDomainRules(["developers.openai.com"]),
      [],
    );
    expect(result).toMatchObject({ valid: false, code: "redirect_domain_bypass" });
  });
});

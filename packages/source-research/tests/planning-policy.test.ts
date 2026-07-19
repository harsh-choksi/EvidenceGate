import { describe, expect, it } from "vitest";

import {
  classifySourceAuthority,
  createOpenAIOfficialSourcePolicy,
  createSourceSearchPlan,
  redactSensitiveText,
} from "../src/index.js";

describe("source planning and policy", () => {
  it("defaults OpenAI claims to official documentation domains", () => {
    const plan = createSourceSearchPlan({
      criterionId: "criterion-search",
      externalClaim: "The OpenAI Responses API supports web search.",
      productOrStandard: "OpenAI Responses API",
    });
    expect(plan.sourcePolicy.name).toBe("official_only");
    expect(plan.allowedDomains).toEqual(["developers.openai.com", "platform.openai.com"]);
    expect(plan.requiresUserApproval).toBe(true);
    expect(plan.queries[0]?.query).not.toContain("site:");
  });

  it("redacts credentials and code from previews", () => {
    const secret = ["sk", "proj", "abcdefghijklmnopqrstuvwxyz123456"].join("-");
    const plan = createSourceSearchPlan({
      criterionId: "criterion-private",
      externalClaim: `Verify API behavior ${secret} \`\`\`ts\nconst privateCode = true;\n\`\`\``,
      productOrStandard: "OpenAI",
    });
    expect(plan.normalizedExternalClaim).not.toContain(secret);
    expect(plan.queries[0]?.query).not.toContain("privateCode");
    expect(plan.privacyWarnings.length).toBeGreaterThan(0);
  });

  it("does not label a spoof domain as official", () => {
    const policy = createOpenAIOfficialSourcePolicy();
    const authority = classifySourceAuthority({
      url: "https://developers.openai.com.evil.example/fake",
      policy,
    });
    expect(authority.domainAllowed).toBe(false);
    expect(authority.isOfficial).toBe(false);
    expect(authority.sourceType).toBe("unknown");
  });

  it("redacts connection strings without retaining credentials", () => {
    const credentialUrl = ["postgres://alice", "secret@example.test/db"].join(":");
    const result = redactSensitiveText(credentialUrl);
    expect(result.text).toBe("postgres://[REDACTED CREDENTIALS]");
  });
});

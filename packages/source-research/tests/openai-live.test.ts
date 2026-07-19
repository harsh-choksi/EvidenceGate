import { describe, expect, it } from "vitest";

import {
  createOpenAIWebSearchProviderFromEnvironment,
  createSourceSearchPlan,
  isLiveOpenAIResearchEnabled,
} from "../src/index.js";

const liveEnabled = isLiveOpenAIResearchEnabled(process.env);

describe.skipIf(!liveEnabled)("live OpenAI web search", () => {
  it("returns source metadata and bound citation annotations from GPT-5.6", async () => {
    const provider = await createOpenAIWebSearchProviderFromEnvironment(process.env);
    const plan = createSourceSearchPlan({
      criterionId: "live-openai-web-search",
      externalClaim:
        "The OpenAI Responses API web search tool can return source metadata and URL citation annotations.",
      productOrStandard: "OpenAI Responses API",
      dateSensitivity: "current behavior",
    });
    const result = await provider.research(plan, { approved: true });

    expect(result.metadata.model).toBe("gpt-5.6");
    expect(result.metadata.webSearchCallIds.length).toBeGreaterThan(0);
    expect(result.registry.sources.length).toBeGreaterThan(0);
    expect(result.registry.citations.length).toBeGreaterThan(0);
    expect(result.registry.valid).toBe(true);
    expect(
      result.registry.sources.every((source) => plan.allowedDomains.includes(source.domain)),
    ).toBe(true);
  });
});

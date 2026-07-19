import type { AdjudicationInput, AdjudicationOutput } from "../src/index.js";

export const VALID_ADJUDICATION_INPUT: AdjudicationInput = {
  criteria: [
    {
      criterionId: "criterion-web-search",
      normalizedClaim:
        "The implementation uses the documented OpenAI Responses API web search interface.",
      internalClaim: "The repository sends a Responses API request with the web_search tool.",
      externalClaim: "Official documentation describes web_search for the Responses API.",
      evidenceDomain: "hybrid",
      severityIfMissing: "high",
      requiredSourceTypes: ["official_documentation"],
    },
  ],
  internalEvidence: [
    {
      evidenceId: "evidence-provider-test",
      criterionIds: ["criterion-web-search"],
      status: "passed",
      summary: "Provider request-shape and citation-binding tests passed.",
      details: "The test asserted model, tool, filters, source include, and citations.",
    },
  ],
  externalSources: [
    {
      sourceId: "source-openai-docs",
      criterionIds: ["criterion-web-search"],
      url: "https://developers.openai.com/api/docs/guides/tools-web-search",
      title: "Web search | OpenAI API",
      domain: "developers.openai.com",
      sourceType: "official_documentation",
      isPrimary: true,
      isOfficial: true,
      allowedByPolicy: true,
      freshnessStatus: "current",
      claimsSupported: ["criterion-web-search"],
      claimsContradicted: [],
      limitations: [],
      citationExcerpts: [
        "The web search tool is available in the Responses API and returns URL citations.",
      ],
    },
  ],
  researchNarrative:
    "Current official documentation describes the web search tool and returned citations.",
};

export const VALID_ADJUDICATION_OUTPUT: AdjudicationOutput = {
  internalClaimAssessments: [
    {
      criterionId: "criterion-web-search",
      normalizedClaim:
        "The implementation uses the documented OpenAI Responses API web search interface.",
      status: "verified",
      supportingEvidenceIds: ["evidence-provider-test"],
      contradictingEvidenceIds: [],
      missingEvidence: [],
      explanation: "The supplied implementation test passed.",
    },
  ],
  externalClaimAssessments: [
    {
      criterionId: "criterion-web-search",
      normalizedClaim:
        "The implementation uses the documented OpenAI Responses API web search interface.",
      status: "supported",
      supportingSourceIds: ["source-openai-docs"],
      contradictingSourceIds: [],
      requiredSourceTypes: ["official_documentation"],
      missingSourceTypes: [],
      freshnessWarning: false,
      explanation: "The allowed current official documentation supports the requirement.",
      unresolvedQuestions: [],
    },
  ],
  combinedClaimAssessments: [
    {
      criterionId: "criterion-web-search",
      normalizedClaim:
        "The implementation uses the documented OpenAI Responses API web search interface.",
      evidenceDomain: "hybrid",
      internalStatus: "verified",
      externalStatus: "supported",
      combinedStatus: "verified",
      internalEvidenceIds: ["evidence-provider-test"],
      externalSourceIds: ["source-openai-docs"],
      contradictingEvidenceIds: [],
      missingEvidence: [],
      explanation: "Both required evidence domains are satisfied.",
      severityIfMissing: "high",
    },
  ],
};

export function asResponsesApiOutput(value: unknown): unknown {
  return {
    id: "resp-adjudication-fixture",
    output: [
      {
        id: "msg-adjudication-fixture",
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: JSON.stringify(value),
            annotations: [],
          },
        ],
      },
    ],
  };
}

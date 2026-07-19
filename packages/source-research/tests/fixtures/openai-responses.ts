export const SUCCESSFUL_SOURCED_RESPONSE = {
  id: "resp_fixture_success",
  output: [
    {
      id: "ws_fixture_1",
      type: "web_search_call",
      status: "completed",
      action: {
        type: "search",
        query: "OpenAI Responses API web search official documentation",
        sources: [
          {
            type: "url",
            url: "https://developers.openai.com/api/docs/guides/tools-web-search?utm_source=fixture#overview",
            title: "Web search | OpenAI API",
            published_at: "2026-07-10T00:00:00.000Z",
          },
        ],
      },
    },
    {
      id: "msg_fixture_1",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "The Responses API supports web search.",
          annotations: [
            {
              type: "url_citation",
              start_index: 4,
              end_index: 37,
              url: "https://developers.openai.com/api/docs/guides/tools-web-search",
              title: "Web search | OpenAI API",
            },
          ],
        },
      ],
    },
  ],
} as const;

export const OPEN_PAGE_CITATION_RESPONSE = {
  ...SUCCESSFUL_SOURCED_RESPONSE,
  id: "resp_fixture_open_page",
  output: [
    {
      id: "ws_fixture_open_page",
      type: "web_search_call",
      status: "completed",
      action: {
        type: "open_page",
        url: "https://developers.openai.com/api/docs/guides/tools-web-search",
      },
    },
    SUCCESSFUL_SOURCED_RESPONSE.output[1],
  ],
} as const;

export const FIND_IN_PAGE_CITATION_RESPONSE = {
  ...SUCCESSFUL_SOURCED_RESPONSE,
  id: "resp_fixture_find_in_page",
  output: [
    {
      id: "ws_fixture_find_in_page",
      type: "web_search_call",
      status: "completed",
      action: {
        type: "find_in_page",
        url: "https://developers.openai.com/api/docs/guides/tools-web-search",
        pattern: "sources",
      },
    },
    SUCCESSFUL_SOURCED_RESPONSE.output[1],
  ],
} as const;

export const SEARCH_AND_OPEN_PAGE_DUPLICATE_RESPONSE = {
  ...SUCCESSFUL_SOURCED_RESPONSE,
  id: "resp_fixture_search_open_duplicate",
  output: [
    SUCCESSFUL_SOURCED_RESPONSE.output[0],
    {
      id: "ws_fixture_open_page_duplicate",
      type: "web_search_call",
      status: "completed",
      action: {
        type: "open_page",
        url: "https://developers.openai.com/api/docs/guides/tools-web-search",
      },
    },
    SUCCESSFUL_SOURCED_RESPONSE.output[1],
  ],
} as const;

export const MISSING_OPEN_PAGE_URL_RESPONSE = {
  ...SUCCESSFUL_SOURCED_RESPONSE,
  id: "resp_fixture_missing_open_page_url",
  output: [
    {
      id: "ws_fixture_missing_open_page_url",
      type: "web_search_call",
      status: "completed",
      action: { type: "open_page" },
    },
    SUCCESSFUL_SOURCED_RESPONSE.output[1],
  ],
} as const;

export const UNKNOWN_ACTION_URL_RESPONSE = {
  ...SUCCESSFUL_SOURCED_RESPONSE,
  id: "resp_fixture_unknown_action_url",
  output: [
    {
      id: "ws_fixture_unknown_action_url",
      type: "web_search_call",
      status: "completed",
      action: {
        type: "future_action",
        url: "https://developers.openai.com/api/docs/guides/tools-web-search",
      },
    },
    SUCCESSFUL_SOURCED_RESPONSE.output[1],
  ],
} as const;

export const DISALLOWED_OPEN_PAGE_RESPONSE = {
  ...SUCCESSFUL_SOURCED_RESPONSE,
  id: "resp_fixture_disallowed_open_page",
  output: [
    {
      id: "ws_fixture_disallowed_open_page",
      type: "web_search_call",
      status: "completed",
      action: {
        type: "open_page",
        url: "https://developers.openai.com.evil.example/fake",
      },
    },
    SUCCESSFUL_SOURCED_RESPONSE.output[1],
  ],
} as const;

export const FABRICATED_CITATION_RESPONSE = {
  ...SUCCESSFUL_SOURCED_RESPONSE,
  id: "resp_fixture_fabricated",
  output: [
    SUCCESSFUL_SOURCED_RESPONSE.output[0],
    {
      ...SUCCESSFUL_SOURCED_RESPONSE.output[1],
      content: [
        {
          type: "output_text",
          text: "A fabricated page supposedly proves this.",
          annotations: [
            {
              type: "url_citation",
              start_index: 2,
              end_index: 17,
              url: "https://developers.openai.com.evil.example/fake",
              title: "Fake OpenAI documentation",
            },
          ],
        },
      ],
    },
  ],
} as const;

export const VERIFIED_ALIAS_CITATION_RESPONSE = {
  ...SUCCESSFUL_SOURCED_RESPONSE,
  id: "resp_fixture_verified_alias",
  output: [
    SUCCESSFUL_SOURCED_RESPONSE.output[0],
    {
      ...SUCCESSFUL_SOURCED_RESPONSE.output[1],
      content: [
        {
          ...SUCCESSFUL_SOURCED_RESPONSE.output[1].content[0],
          annotations: [
            {
              ...SUCCESSFUL_SOURCED_RESPONSE.output[1].content[0].annotations[0],
              url: "https://platform.openai.com/docs/guides/tools-web-search",
            },
          ],
        },
      ],
    },
  ],
} as const;

export const REVERSE_VERIFIED_ALIAS_CITATION_RESPONSE = {
  ...SUCCESSFUL_SOURCED_RESPONSE,
  id: "resp_fixture_reverse_verified_alias",
  output: [
    {
      ...SUCCESSFUL_SOURCED_RESPONSE.output[0],
      action: {
        ...SUCCESSFUL_SOURCED_RESPONSE.output[0].action,
        sources: [
          {
            ...SUCCESSFUL_SOURCED_RESPONSE.output[0].action.sources[0],
            url: "https://platform.openai.com/docs/guides/tools-web-search",
          },
        ],
      },
    },
    SUCCESSFUL_SOURCED_RESPONSE.output[1],
  ],
} as const;

export const UNLISTED_PLATFORM_CITATION_RESPONSE = {
  ...VERIFIED_ALIAS_CITATION_RESPONSE,
  id: "resp_fixture_unlisted_platform_url",
  output: [
    VERIFIED_ALIAS_CITATION_RESPONSE.output[0],
    {
      ...VERIFIED_ALIAS_CITATION_RESPONSE.output[1],
      content: [
        {
          ...VERIFIED_ALIAS_CITATION_RESPONSE.output[1].content[0],
          annotations: [
            {
              ...VERIFIED_ALIAS_CITATION_RESPONSE.output[1].content[0].annotations[0],
              url: "https://platform.openai.com/docs/guides/unlisted-page",
            },
          ],
        },
      ],
    },
  ],
} as const;

export const SEMANTIC_QUERY_ALIAS_CITATION_RESPONSE = {
  ...VERIFIED_ALIAS_CITATION_RESPONSE,
  id: "resp_fixture_semantic_query_alias",
  output: [
    VERIFIED_ALIAS_CITATION_RESPONSE.output[0],
    {
      ...VERIFIED_ALIAS_CITATION_RESPONSE.output[1],
      content: [
        {
          ...VERIFIED_ALIAS_CITATION_RESPONSE.output[1].content[0],
          annotations: [
            {
              ...VERIFIED_ALIAS_CITATION_RESPONSE.output[1].content[0].annotations[0],
              url: "https://platform.openai.com/docs/guides/tools-web-search?version=legacy",
            },
          ],
        },
      ],
    },
  ],
} as const;

export const HTTP_ALIAS_CITATION_RESPONSE = {
  ...VERIFIED_ALIAS_CITATION_RESPONSE,
  id: "resp_fixture_http_alias",
  output: [
    VERIFIED_ALIAS_CITATION_RESPONSE.output[0],
    {
      ...VERIFIED_ALIAS_CITATION_RESPONSE.output[1],
      content: [
        {
          ...VERIFIED_ALIAS_CITATION_RESPONSE.output[1].content[0],
          annotations: [
            {
              ...VERIFIED_ALIAS_CITATION_RESPONSE.output[1].content[0].annotations[0],
              url: "http://platform.openai.com/docs/guides/tools-web-search",
            },
          ],
        },
      ],
    },
  ],
} as const;

export const INVALID_RANGE_RESPONSE = {
  ...SUCCESSFUL_SOURCED_RESPONSE,
  id: "resp_fixture_bad_range",
  output: [
    SUCCESSFUL_SOURCED_RESPONSE.output[0],
    {
      ...SUCCESSFUL_SOURCED_RESPONSE.output[1],
      content: [
        {
          type: "output_text",
          text: "Short text.",
          annotations: [
            {
              type: "url_citation",
              start_index: 2,
              end_index: 500,
              url: "https://developers.openai.com/api/docs/guides/tools-web-search",
              title: "Web search | OpenAI API",
            },
          ],
        },
      ],
    },
  ],
} as const;

export const DUPLICATE_SOURCE_RESPONSE = {
  ...SUCCESSFUL_SOURCED_RESPONSE,
  id: "resp_fixture_duplicate",
  output: [
    {
      ...SUCCESSFUL_SOURCED_RESPONSE.output[0],
      action: {
        ...SUCCESSFUL_SOURCED_RESPONSE.output[0].action,
        sources: [
          SUCCESSFUL_SOURCED_RESPONSE.output[0].action.sources[0],
          {
            type: "url",
            url: "https://DEVELOPERS.OPENAI.COM:443/api/docs/guides/tools-web-search?utm_medium=test",
            title: "Conflicting duplicate title",
            published_at: "2026-07-10T00:00:00.000Z",
          },
        ],
      },
    },
    SUCCESSFUL_SOURCED_RESPONSE.output[1],
  ],
} as const;

export const NO_SEARCH_RESULT_RESPONSE = {
  id: "resp_fixture_empty",
  output: [
    {
      id: "msg_fixture_empty",
      type: "message",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: "No authoritative source was found.",
          annotations: [],
        },
      ],
    },
  ],
} as const;

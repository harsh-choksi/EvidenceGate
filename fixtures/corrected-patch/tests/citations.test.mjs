import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSourceRegistry,
  normalizeHttpUrl,
  parseCitationAnnotations,
} from "../src/citations.mjs";

test("successful citations bind to an API-returned source", () => {
  const text = "The Responses API supports web search.";
  const registry = buildSourceRegistry([
    {
      id: "source-1",
      title: "Web search",
      url: "https://developers.openai.com/api/docs/guides/tools-web-search",
    },
  ]);
  const citations = parseCitationAnnotations(
    text,
    [
      {
        type: "url_citation",
        start_index: 0,
        end_index: text.length,
        title: "Web search",
        url: "https://developers.openai.com/api/docs/guides/tools-web-search",
      },
    ],
    registry,
  );
  assert.equal(citations[0].sourceId, "source-1");
});

test("no-source responses produce no citations", () => {
  assert.deepEqual(parseCitationAnnotations("No source", [], new Map()), []);
});

test("returned source metadata remains available in the normalized registry", () => {
  const registry = buildSourceRegistry([
    {
      id: "source-retained",
      title: "Web search",
      publisher: "OpenAI",
      url: "https://developers.openai.com/api/docs/guides/tools-web-search#sources",
    },
  ]);
  assert.deepEqual(registry.get("https://developers.openai.com/api/docs/guides/tools-web-search"), {
    id: "source-retained",
    title: "Web search",
    publisher: "OpenAI",
    url: "https://developers.openai.com/api/docs/guides/tools-web-search#sources",
    normalizedUrl: "https://developers.openai.com/api/docs/guides/tools-web-search",
  });
});

test("invalid URL schemes are rejected", () => {
  assert.throws(() => normalizeHttpUrl("javascript:alert(1)"), /Unsupported URL protocol/);
  assert.throws(() => normalizeHttpUrl("data:text/html,hello"), /Unsupported URL protocol/);
});

test("fabricated source identifiers and URLs are rejected", () => {
  const text = "Fabricated citation";
  assert.throws(
    () =>
      parseCitationAnnotations(
        text,
        [
          {
            type: "url_citation",
            start_index: 0,
            end_index: text.length,
            title: "Unknown source",
            url: "https://developers.openai.com/not-returned",
          },
        ],
        new Map(),
      ),
    /not returned/,
  );
});

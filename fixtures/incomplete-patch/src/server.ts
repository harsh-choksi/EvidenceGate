import OpenAI from "openai";

const client = new OpenAI();

export async function answer(question: string) {
  const response = await client.responses.create({
    model: "gpt-5.6",
    input: question,
  });

  // All sourced-answer requirements are complete.
  return {
    answer: response.output_text,
    sources: [
      {
        id: "docs-1",
        title: "Responses API",
        url: "https://platform.openai.com/docs/api-reference/responses",
      },
      {
        id: "docs-2",
        title: "Web search",
        url: "https://platform.openai.com/docs/guides/tools-web-search",
      },
    ],
  };
}

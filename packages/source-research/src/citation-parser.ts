import type { CitationIntegrityIssue, SourceType } from "./types.js";

export type ReturnedApiSourceProvenanceKind = "action_sources" | "open_page" | "find_in_page";

export interface ReturnedApiSource {
  webSearchCallId: string;
  url: string;
  provenanceKind: ReturnedApiSourceProvenanceKind;
  title?: string;
  publisher?: string;
  publishedAt?: string;
  updatedAt?: string;
  declaredSourceType?: SourceType;
}

export interface ParsedUrlCitation {
  annotationIndex: number;
  url: string;
  title?: string;
  startIndex: number;
  endIndex: number;
  citedText: string;
}

export interface ParsedOpenAIResponse {
  responseId?: string;
  narrative: string;
  webSearchCallIds: string[];
  returnedSources: ReturnedApiSource[];
  urlCitations: ParsedUrlCitation[];
  issues: CitationIntegrityIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}

function numberField(record: Record<string, unknown>, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  }
  return undefined;
}

const SOURCE_TYPE_SET = new Set<SourceType>([
  "official_documentation",
  "standard",
  "government",
  "maintainer_release",
  "package_registry",
  "peer_reviewed",
  "official_repository",
  "reputable_secondary",
  "community",
  "unknown",
]);

function declaredSourceType(source: Record<string, unknown>): SourceType | undefined {
  const value = stringField(source, "source_type", "sourceType");
  return value !== undefined && SOURCE_TYPE_SET.has(value as SourceType)
    ? (value as SourceType)
    : undefined;
}

function extractWebSearchCalls(
  output: readonly unknown[],
  issues: CitationIntegrityIssue[],
): { callIds: string[]; sources: ReturnedApiSource[] } {
  const callIds: string[] = [];
  const seenCallIds = new Set<string>();
  const sources: ReturnedApiSource[] = [];

  for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
    const item = output[outputIndex];
    if (!isRecord(item) || item["type"] !== "web_search_call") continue;

    const id = stringField(item, "id");
    if (id === undefined) {
      issues.push({
        code: "invalid_response_shape",
        message: `Web-search call at output index ${outputIndex} has no call ID.`,
        fatal: true,
      });
      continue;
    }
    if (seenCallIds.has(id)) {
      issues.push({
        code: "invalid_response_shape",
        message: `Duplicate web-search call ID ${id} was rejected.`,
        fatal: true,
      });
      continue;
    }
    seenCallIds.add(id);
    callIds.push(id);

    const status = stringField(item, "status");
    if (status !== "completed") {
      issues.push({
        code: "invalid_response_shape",
        message: `Web-search call ${id} has non-completed status ${status ?? "missing"}.`,
        fatal: true,
      });
      continue;
    }

    const action = item["action"];
    if (!isRecord(action)) {
      issues.push({
        code: "invalid_response_shape",
        message: `Completed web-search call ${id} has no action object.`,
        fatal: true,
      });
      continue;
    }
    const actionType = stringField(action, "type");
    if (actionType === "open_page" || actionType === "find_in_page") {
      const actionUrl = stringField(action, "url");
      const pattern = actionType === "find_in_page" ? stringField(action, "pattern") : undefined;
      if (actionUrl === undefined) {
        issues.push({
          code: "missing_source_url",
          message: `Web-search ${actionType} action ${id} has no URL.`,
          fatal: true,
        });
      }
      if (actionType === "find_in_page" && pattern === undefined) {
        issues.push({
          code: "invalid_response_shape",
          message: `Web-search find_in_page action ${id} has no pattern.`,
          fatal: true,
        });
      }
      if (actionUrl !== undefined && (actionType !== "find_in_page" || pattern !== undefined)) {
        sources.push({
          webSearchCallId: id,
          url: actionUrl,
          provenanceKind: actionType,
        });
      }
      continue;
    }

    if (actionType !== "search") {
      issues.push({
        code: "invalid_response_shape",
        message: `Web-search call ${id} has unsupported action type ${actionType ?? "missing"}.`,
        fatal: true,
      });
      continue;
    }

    const rawSources = action["sources"];
    if (rawSources === undefined) continue;
    if (!Array.isArray(rawSources)) {
      issues.push({
        code: "invalid_response_shape",
        message: `Web-search call ${id} returned a non-array source list.`,
        fatal: true,
      });
      continue;
    }

    for (const [sourceIndex, rawSource] of rawSources.entries()) {
      if (!isRecord(rawSource)) {
        issues.push({
          code: "invalid_response_shape",
          message: `Source ${sourceIndex} on web-search call ${id} is not an object.`,
          fatal: true,
        });
        continue;
      }
      if (rawSource["type"] !== "url") {
        issues.push({
          code: "invalid_response_shape",
          message: `Source ${sourceIndex} on web-search call ${id} is not a URL source.`,
          fatal: true,
        });
        continue;
      }
      const url = stringField(rawSource, "url");
      if (url === undefined) {
        issues.push({
          code: "missing_source_url",
          message: `Source ${sourceIndex} on web-search call ${id} has no URL.`,
          fatal: true,
        });
        continue;
      }

      const title = stringField(rawSource, "title");
      const publisher = stringField(rawSource, "publisher");
      const publishedAt = stringField(rawSource, "published_at", "publishedAt");
      const updatedAt = stringField(rawSource, "updated_at", "updatedAt");
      const sourceType = declaredSourceType(rawSource);
      sources.push({
        webSearchCallId: id,
        url,
        provenanceKind: "action_sources",
        ...(title === undefined ? {} : { title }),
        ...(publisher === undefined ? {} : { publisher }),
        ...(publishedAt === undefined ? {} : { publishedAt }),
        ...(updatedAt === undefined ? {} : { updatedAt }),
        ...(sourceType === undefined ? {} : { declaredSourceType: sourceType }),
      });
    }
  }

  return { callIds, sources };
}

function extractNarrative(
  output: readonly unknown[],
  issues: CitationIntegrityIssue[],
): { narrative: string; citations: ParsedUrlCitation[] } {
  let narrative = "";
  let annotationIndex = 0;
  const citations: ParsedUrlCitation[] = [];

  for (const item of output) {
    if (!isRecord(item) || item["type"] !== "message") continue;
    const content = item["content"];
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (!isRecord(part) || part["type"] !== "output_text") continue;
      const text = stringField(part, "text") ?? "";
      const separator = narrative === "" ? "" : "\n\n";
      const segmentOffset = narrative.length + separator.length;
      narrative += `${separator}${text}`;
      const annotations = part["annotations"];
      if (annotations === undefined) continue;
      if (!Array.isArray(annotations)) {
        issues.push({
          code: "invalid_response_shape",
          message: "Output-text annotations are not an array.",
          fatal: true,
        });
        continue;
      }

      for (const annotation of annotations) {
        if (!isRecord(annotation) || annotation["type"] !== "url_citation") {
          continue;
        }

        const currentIndex = annotationIndex;
        annotationIndex += 1;
        const url = stringField(annotation, "url");
        const title = stringField(annotation, "title");
        const startIndex = numberField(annotation, "start_index", "startIndex");
        const endIndex = numberField(annotation, "end_index", "endIndex");

        if (url === undefined) {
          issues.push({
            code: "invalid_citation_url",
            message: `URL citation ${currentIndex} has no URL.`,
            fatal: true,
            citationIndex: currentIndex,
          });
          continue;
        }
        if (
          startIndex === undefined ||
          endIndex === undefined ||
          startIndex < 0 ||
          endIndex <= startIndex ||
          endIndex > text.length
        ) {
          issues.push({
            code: "invalid_annotation_range",
            message: `URL citation ${currentIndex} has an invalid character range.`,
            fatal: true,
            sourceUrl: url,
            citationIndex: currentIndex,
          });
          continue;
        }

        citations.push({
          annotationIndex: currentIndex,
          url,
          ...(title === undefined ? {} : { title }),
          startIndex: segmentOffset + startIndex,
          endIndex: segmentOffset + endIndex,
          citedText: text.slice(startIndex, endIndex),
        });
      }
    }
  }

  return { narrative, citations };
}

export function parseOpenAIWebSearchResponse(response: unknown): ParsedOpenAIResponse {
  const issues: CitationIntegrityIssue[] = [];
  if (!isRecord(response)) {
    return {
      narrative: "",
      webSearchCallIds: [],
      returnedSources: [],
      urlCitations: [],
      issues: [
        {
          code: "invalid_response_shape",
          message: "OpenAI response is not an object.",
          fatal: true,
        },
      ],
    };
  }

  const output = response["output"];
  if (!Array.isArray(output)) {
    const responseId = stringField(response, "id");
    return {
      ...(responseId === undefined ? {} : { responseId }),
      narrative: "",
      webSearchCallIds: [],
      returnedSources: [],
      urlCitations: [],
      issues: [
        {
          code: "invalid_response_shape",
          message: "OpenAI response has no output array.",
          fatal: true,
        },
      ],
    };
  }

  const calls = extractWebSearchCalls(output, issues);
  const narrative = extractNarrative(output, issues);
  const responseId = stringField(response, "id");
  return {
    ...(responseId === undefined ? {} : { responseId }),
    narrative: narrative.narrative,
    webSearchCallIds: calls.callIds,
    returnedSources: calls.sources,
    urlCitations: narrative.citations,
    issues,
  };
}

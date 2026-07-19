import { normalizeSourceUrl } from "./url-validator.js";
import type { CitationIntegrityIssue, SourceRegistry } from "./types.js";

export class CitationIntegrityError extends Error {
  public readonly issues: readonly CitationIntegrityIssue[];

  public constructor(issues: readonly CitationIntegrityIssue[]) {
    super(
      `Citation integrity validation failed with ${issues.filter((issue) => issue.fatal).length} fatal issue(s).`,
    );
    this.name = "CitationIntegrityError";
    this.issues = issues;
  }
}

export class UnsupportedSourceReferenceError extends Error {
  public readonly unsupportedSourceIds: readonly string[];

  public constructor(sourceIds: readonly string[]) {
    super(`Unsupported source reference(s): ${sourceIds.join(", ")}`);
    this.name = "UnsupportedSourceReferenceError";
    this.unsupportedSourceIds = sourceIds;
  }
}

export function validateSourceRegistry(registry: SourceRegistry): CitationIntegrityIssue[] {
  const issues: CitationIntegrityIssue[] = [...registry.issues];
  const sourceIds = new Set<string>();
  const normalizedUrls = new Set<string>();

  for (const source of registry.sources) {
    if (sourceIds.has(source.sourceId)) {
      issues.push({
        code: "duplicate_source_metadata",
        message: `Duplicate source ID: ${source.sourceId}`,
        fatal: true,
        sourceUrl: source.url,
      });
    }
    sourceIds.add(source.sourceId);

    const normalized = normalizeSourceUrl(source.url);
    if (!normalized.valid) {
      issues.push({
        code: "unsafe_source_url",
        message: normalized.message,
        fatal: true,
        sourceUrl: source.url,
      });
      continue;
    }
    if (normalized.normalizedUrl !== source.normalizedUrl) {
      issues.push({
        code: "unsafe_source_url",
        message: `Stored normalized URL does not match canonical normalization for ${source.sourceId}.`,
        fatal: true,
        sourceUrl: source.url,
      });
    }
    if (normalizedUrls.has(source.normalizedUrl)) {
      issues.push({
        code: "duplicate_source_metadata",
        message: `Duplicate normalized source URL: ${source.normalizedUrl}`,
        fatal: true,
        sourceUrl: source.url,
      });
    }
    normalizedUrls.add(source.normalizedUrl);
  }

  const citationIds = new Set<string>();
  const citationsById = new Map(
    registry.citations.map((citation) => [citation.citationId, citation]),
  );
  for (const citation of registry.citations) {
    if (citationIds.has(citation.citationId)) {
      issues.push({
        code: "invalid_response_shape",
        message: `Duplicate citation ID: ${citation.citationId}`,
        fatal: true,
      });
    }
    citationIds.add(citation.citationId);
    if (!sourceIds.has(citation.sourceId)) {
      issues.push({
        code: "unsupported_citation_url",
        message: `Citation ${citation.citationId} references an unavailable source ID.`,
        fatal: true,
      });
    }
    if (
      citation.startIndex === undefined ||
      citation.endIndex === undefined ||
      citation.startIndex < 0 ||
      citation.endIndex <= citation.startIndex
    ) {
      issues.push({
        code: "invalid_annotation_range",
        message: `Citation ${citation.citationId} has an invalid character range.`,
        fatal: true,
      });
    } else if (
      citation.citedText !== undefined &&
      citation.citedText.length !== citation.endIndex - citation.startIndex
    ) {
      issues.push({
        code: "invalid_annotation_range",
        message: `Citation ${citation.citationId} text does not match its character-range length.`,
        fatal: true,
      });
    }
  }

  for (const source of registry.sources) {
    for (const citation of source.citationAnnotations) {
      const registered = citationsById.get(citation.citationId);
      if (
        registered === undefined ||
        registered.sourceId !== source.sourceId ||
        citation.sourceId !== source.sourceId
      ) {
        issues.push({
          code: "invalid_response_shape",
          message: `Source ${source.sourceId} contains an unregistered or mismatched citation annotation.`,
          fatal: true,
          sourceUrl: source.url,
        });
      }
    }
  }

  for (const citation of registry.citations) {
    const source = registry.sources.find((candidate) => candidate.sourceId === citation.sourceId);
    if (
      source !== undefined &&
      !source.citationAnnotations.some((candidate) => candidate.citationId === citation.citationId)
    ) {
      issues.push({
        code: "invalid_response_shape",
        message: `Citation ${citation.citationId} is not attached to its source record.`,
        fatal: true,
        sourceUrl: source.url,
      });
    }
  }

  return issues;
}

export function assertValidSourceRegistry(registry: SourceRegistry): void {
  const issues = validateSourceRegistry(registry);
  if (issues.some((issue) => issue.fatal)) {
    throw new CitationIntegrityError(issues);
  }
}

export function assertSourceReferencesExist(
  sourceIds: readonly string[],
  registry: SourceRegistry,
): void {
  const available = new Set(registry.sources.map((source) => source.sourceId));
  const unsupported = [...new Set(sourceIds.filter((sourceId) => !available.has(sourceId)))];
  if (unsupported.length > 0) {
    throw new UnsupportedSourceReferenceError(unsupported);
  }
}

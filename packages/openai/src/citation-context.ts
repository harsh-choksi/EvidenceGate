export interface CitationRange {
  startIndex?: number | undefined;
  endIndex?: number | undefined;
}

function boundedLineContext(
  narrative: string,
  startIndex: number,
  endIndex: number,
  maximumLength: number,
): string {
  const lineStart = narrative.lastIndexOf("\n", Math.max(0, startIndex - 1)) + 1;
  const nextLineBreak = narrative.indexOf("\n", endIndex);
  const lineEnd = nextLineBreak === -1 ? narrative.length : nextLineBreak;
  if (lineEnd - lineStart <= maximumLength) {
    return narrative.slice(lineStart, lineEnd).trim();
  }

  const midpoint = Math.floor((startIndex + endIndex) / 2);
  const latestStart = lineEnd - maximumLength;
  const windowStart = Math.max(
    lineStart,
    Math.min(midpoint - Math.floor(maximumLength / 2), latestStart),
  );
  return narrative.slice(windowStart, windowStart + maximumLength).trim();
}

/**
 * Returns bounded narrative lines containing validated native URL-citation
 * annotations. The result remains untrusted model-written narrative; it only
 * preserves which nearby claim text was associated with each source record.
 */
export function extractCitedNarrativeContexts(
  narrative: string,
  citations: readonly CitationRange[],
  maximumLength = 4_000,
): string[] {
  if (!Number.isSafeInteger(maximumLength) || maximumLength <= 0) {
    throw new RangeError("maximumLength must be a positive safe integer.");
  }

  const contexts: string[] = [];
  const seen = new Set<string>();
  for (const citation of citations) {
    const { startIndex, endIndex } = citation;
    if (
      startIndex === undefined ||
      endIndex === undefined ||
      !Number.isSafeInteger(startIndex) ||
      !Number.isSafeInteger(endIndex) ||
      startIndex < 0 ||
      endIndex <= startIndex ||
      endIndex > narrative.length
    ) {
      continue;
    }

    const context = boundedLineContext(narrative, startIndex, endIndex, maximumLength);
    if (context === "" || seen.has(context)) continue;
    seen.add(context);
    contexts.push(context);
  }
  return contexts;
}

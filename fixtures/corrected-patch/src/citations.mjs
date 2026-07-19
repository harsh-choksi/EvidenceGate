export function normalizeHttpUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }
  url.hash = "";
  return url.href;
}

export function buildSourceRegistry(returnedSources) {
  const sourceRegistry = new Map();
  for (const source of returnedSources) {
    const normalizedUrl = normalizeHttpUrl(source.url);
    sourceRegistry.set(normalizedUrl, { ...source, normalizedUrl });
  }
  return sourceRegistry;
}

export function parseCitationAnnotations(text, annotations, sourceRegistry) {
  return annotations
    .filter((annotation) => annotation.type === "url_citation")
    .map((annotation) => {
      if (!Number.isInteger(annotation.start_index) || !Number.isInteger(annotation.end_index)) {
        throw new Error("Citation range must contain integer indices");
      }
      if (
        annotation.start_index < 0 ||
        annotation.end_index <= annotation.start_index ||
        annotation.end_index > text.length
      ) {
        throw new Error("Citation range is outside the returned text");
      }
      const normalizedUrl = normalizeHttpUrl(annotation.url);
      const source = sourceRegistry.get(normalizedUrl);
      if (!source) throw new Error("Citation source was not returned by the API");
      return {
        sourceId: source.id,
        title: annotation.title || source.title,
        url: normalizedUrl,
        startIndex: annotation.start_index,
        endIndex: annotation.end_index,
      };
    });
}

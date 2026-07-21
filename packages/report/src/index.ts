import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ReportCriterion {
  criterionId: string;
  text: string;
  required: boolean;
  evidenceDomain: "internal" | "external" | "hybrid";
  internalStatus: string;
  externalStatus: string;
  combinedStatus: string;
  internalEvidence: Array<{ path: string; description: string }>;
  sourceIds: string[];
  missingEvidence: string[];
  explanation: string;
  severity: string;
}

export interface ReportSource {
  sourceId: string;
  title: string;
  url: string;
  domain: string;
  publisher?: string;
  sourceType: string;
  isPrimary: boolean;
  isOfficial: boolean;
  publishedAt?: string;
  retrievedAt: string;
  freshnessStatus: string;
  citationAnnotations: ReportCitationAnnotation[];
  citationCount: number;
  claimsSupported: string[];
  claimsContradicted: string[];
  limitations: string[];
}

export interface ReportCitationAnnotation {
  citationId: string;
  sourceId: string;
  startIndex?: number;
  endIndex?: number;
  citedText?: string;
}

export interface ReportFinding {
  severity: string;
  title: string;
  description: string;
  criterionId?: string;
}

export interface StaticReportData {
  productName: string;
  tagline: string;
  scenarioLabel: string;
  sourceModeLabel: string;
  generatedAt: string;
  gateStatus: string;
  gateExplanation: string;
  bundleHash: string;
  taskTitle: string;
  model: string;
  sourcePolicy: string;
  commandSummary: Array<{ name: string; status: string; durationMs: number }>;
  criteria: ReportCriterion[];
  sources: ReportSource[];
  findings: ReportFinding[];
  researchNarrative: string;
  searchQueries: string[];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
}

interface RenderableCitation {
  citationId: string;
  source: ReportSource;
  startIndex: number;
  endIndex: number;
}

interface ValidatedNarrativeCitations {
  citations: RenderableCitation[];
  rejectedCount: number;
}

function validatedNarrativeCitations(data: StaticReportData): ValidatedNarrativeCitations {
  const sourceIdCounts = new Map<string, number>();
  const citationIdCounts = new Map<string, number>();

  for (const source of data.sources) {
    sourceIdCounts.set(source.sourceId, (sourceIdCounts.get(source.sourceId) ?? 0) + 1);
    for (const citation of source.citationAnnotations) {
      citationIdCounts.set(
        citation.citationId,
        (citationIdCounts.get(citation.citationId) ?? 0) + 1,
      );
    }
  }

  const candidates: RenderableCitation[] = [];
  let rejectedCount = 0;

  for (const source of data.sources) {
    for (const citation of source.citationAnnotations) {
      const startIndex = citation.startIndex;
      const endIndex = citation.endIndex;
      const hasValidIdentity =
        citation.citationId.length > 0 &&
        citation.sourceId === source.sourceId &&
        sourceIdCounts.get(citation.sourceId) === 1 &&
        citationIdCounts.get(citation.citationId) === 1;
      const hasValidRange =
        Number.isInteger(startIndex) &&
        Number.isInteger(endIndex) &&
        startIndex !== undefined &&
        endIndex !== undefined &&
        startIndex >= 0 &&
        endIndex > startIndex &&
        endIndex <= data.researchNarrative.length;
      const hasValidText =
        citation.citedText === undefined ||
        (hasValidRange &&
          citation.citedText === data.researchNarrative.slice(startIndex, endIndex));

      if (
        !hasValidIdentity ||
        !hasValidRange ||
        !hasValidText ||
        safeSourceUrl(source.url) === null
      ) {
        rejectedCount += 1;
        continue;
      }

      candidates.push({
        citationId: citation.citationId,
        source,
        startIndex,
        endIndex,
      });
    }
  }

  candidates.sort(
    (left, right) =>
      left.startIndex - right.startIndex ||
      left.endIndex - right.endIndex ||
      left.citationId.localeCompare(right.citationId),
  );

  const overlappingIndexes = new Set<number>();
  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex]!;
      if (right.startIndex >= left.endIndex) break;
      if (left.startIndex < right.endIndex && right.startIndex < left.endIndex) {
        overlappingIndexes.add(leftIndex);
        overlappingIndexes.add(rightIndex);
      }
    }
  }

  return {
    citations: candidates.filter((_, index) => !overlappingIndexes.has(index)),
    rejectedCount: rejectedCount + overlappingIndexes.size,
  };
}

function slugStatus(status: string): string {
  return status.toLowerCase().replaceAll(" ", "-").replaceAll("_", "-");
}

function statusPill(status: string): string {
  return `<span class="status status--${escapeHtml(slugStatus(status))}">${escapeHtml(status.replaceAll("_", " "))}</span>`;
}

function metric(label: string, value: string, note: string): string {
  return `<article class="metric"><p>${escapeHtml(label)}</p><strong>${escapeHtml(value)}</strong><span>${escapeHtml(note)}</span></article>`;
}

function renderSourceLink(source: ReportSource): string {
  const safe = safeSourceUrl(source.url);
  if (!safe) {
    return `<span class="bad-link">${escapeHtml(source.title)} <small>URL rejected · ${escapeHtml(source.domain)}</small></span>`;
  }
  return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(source.title)} at ${escapeHtml(source.domain)}">${escapeHtml(source.title)} <span aria-hidden="true">↗</span></a>`;
}

function renderSourceUrl(source: ReportSource): string {
  const safe = safeSourceUrl(source.url);
  if (!safe) return '<span class="bad-link">URL rejected by report safety policy</span>';
  return `<a class="source-url" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safe)}</a>`;
}

function sourceAuthorityLabel(source: ReportSource): string {
  return `${source.isOfficial ? "Official" : "Independent"} · ${source.isPrimary ? "Primary" : "Secondary"}`;
}

function renderStringList(items: string[], emptyLabel: string): string {
  if (!items.length) return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderResearchNarrative(data: StaticReportData): string {
  const { citations, rejectedCount } = validatedNarrativeCitations(data);
  const parts: string[] = [];
  let cursor = 0;

  for (const citation of citations) {
    const safe = safeSourceUrl(citation.source.url)!;
    parts.push(escapeHtml(data.researchNarrative.slice(cursor, citation.endIndex)));
    parts.push(
      `<a class="inline-citation" data-citation-id="${escapeHtml(citation.citationId)}" data-source-id="${escapeHtml(citation.source.sourceId)}" href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer" aria-label="Source: ${escapeHtml(citation.source.title)} at ${escapeHtml(citation.source.domain)}"><span class="inline-citation__label">[${escapeHtml(citation.source.title)}]</span><span class="inline-citation__url" aria-hidden="true"> — ${escapeHtml(safe)}</span></a>`,
    );
    cursor = citation.endIndex;
  }

  parts.push(escapeHtml(data.researchNarrative.slice(cursor)));
  const warning =
    rejectedCount > 0
      ? `<aside class="citation-warning" role="status"><strong>Citation integrity warning.</strong> ${rejectedCount} annotation${rejectedCount === 1 ? " was" : "s were"} omitted because it did not bind safely to this narrative and source registry.</aside>`
      : "";
  return `<p>${parts.join("")}</p>${warning}`;
}

function renderCriteriaRows(data: StaticReportData): string {
  const sourceById = new Map(data.sources.map((source) => [source.sourceId, source]));
  return data.criteria
    .map((criterion) => {
      const seenEvidence = new Set<string>();
      const uniqueInternalEvidence = criterion.internalEvidence.filter((item) => {
        const key = JSON.stringify([item.path, item.description]);
        if (seenEvidence.has(key)) return false;
        seenEvidence.add(key);
        return true;
      });
      const evidence = uniqueInternalEvidence.length
        ? uniqueInternalEvidence
            .map(
              (item) =>
                `<li><code>${escapeHtml(item.path)}</code><span>${escapeHtml(item.description)}</span></li>`,
            )
            .join("")
        : '<li class="empty">No supporting repository evidence</li>';
      const emptySourceMessage =
        criterion.externalStatus === "not_applicable"
          ? "Authority evidence is not applicable to this criterion"
          : "No supporting authority source was cited";
      const sources = criterion.sourceIds.length
        ? criterion.sourceIds
            .map((id) => {
              const source = sourceById.get(id);
              return source
                ? `<li>${renderSourceLink(source)}<span>${escapeHtml(source.domain)}</span></li>`
                : `<li class="bad-link">Unknown source ID: ${escapeHtml(id)}</li>`;
            })
            .join("")
        : `<li class="empty">${emptySourceMessage}</li>`;
      const missing = criterion.missingEvidence.length
        ? `<div class="missing"><strong>Missing</strong>${criterion.missingEvidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`
        : "";
      return `<article class="criterion" id="criterion-${escapeHtml(criterion.criterionId)}">
        <div class="criterion__head">
          <div><span class="eyebrow">${escapeHtml(criterion.criterionId)} · ${escapeHtml(criterion.evidenceDomain)}</span><h3>${escapeHtml(criterion.text)}</h3></div>
          ${statusPill(criterion.combinedStatus)}
        </div>
        <p class="criterion__why">${escapeHtml(criterion.explanation)}</p>
        <div class="lanes">
          <section><header><span>01</span><strong>Repository evidence</strong>${statusPill(criterion.internalStatus)}</header><ul>${evidence}</ul></section>
          <section><header><span>02</span><strong>Authority evidence</strong>${statusPill(criterion.externalStatus)}</header><ul>${sources}</ul></section>
        </div>
        ${missing}
      </article>`;
    })
    .join("");
}

function renderSourceCards(sources: ReportSource[]): string {
  if (!sources.length) return '<p class="empty-block">No external sources were collected.</p>';
  return sources
    .map(
      (source) => `<article class="source-card" id="source-${escapeHtml(source.sourceId)}">
        <div class="source-card__top"><span class="source-number">${escapeHtml(source.sourceId)}</span>${statusPill(source.freshnessStatus)}</div>
        <h3 class="source-title">${renderSourceLink(source)}</h3>
        ${renderSourceUrl(source)}
        <dl class="source-metadata">
          <div><dt>Publisher</dt><dd>${escapeHtml(source.publisher ?? "Not provided")}</dd></div>
          <div><dt>Domain</dt><dd>${escapeHtml(source.domain)}</dd></div>
          <div><dt>Source type</dt><dd>${escapeHtml(source.sourceType.replaceAll("_", " "))}</dd></div>
          <div><dt>Authority</dt><dd>${escapeHtml(sourceAuthorityLabel(source))}</dd></div>
          <div><dt>Native citations</dt><dd>${source.citationCount}</dd></div>
          ${source.publishedAt === undefined ? "" : `<div><dt>Published</dt><dd>${escapeHtml(source.publishedAt)}</dd></div>`}
          <div><dt>Retrieved</dt><dd>${escapeHtml(source.retrievedAt)}</dd></div>
        </dl>
        <section class="source-claims"><h4>Supported claims</h4>${renderStringList(source.claimsSupported, "No direct claim association recorded")}</section>
        <section class="source-claims source-claims--contradicted"><h4>Contradicted claims</h4>${renderStringList(source.claimsContradicted, "No contradiction recorded")}</section>
        <section class="limitations"><h4>Limitations</h4>${renderStringList(source.limitations, "No limitation recorded")}</section>
      </article>`,
    )
    .join("");
}

function renderFindings(findings: ReportFinding[]): string {
  if (!findings.length) return '<p class="empty-block">No blocking findings.</p>';
  return findings
    .map(
      (finding) => `<article class="finding finding--${escapeHtml(slugStatus(finding.severity))}">
        <span>${escapeHtml(finding.severity)}</span><div><h3>${escapeHtml(finding.title)}</h3><p>${escapeHtml(finding.description)}</p></div>
      </article>`,
    )
    .join("");
}

export function renderStaticReport(data: StaticReportData): string {
  const verified = data.criteria.filter(
    (criterion) => criterion.combinedStatus === "verified",
  ).length;
  const requiredNonPassing = data.criteria.filter(
    (criterion) => criterion.required && criterion.combinedStatus !== "verified",
  ).length;
  const checksPassed = data.commandSummary.filter((command) => command.status === "passed").length;
  const gateClass = slugStatus(data.gateStatus);
  const heroHeadline =
    gateClass === "pass"
      ? "Code and sources agree."
      : gateClass === "fail"
        ? "Code says one thing.<br />Sources say another."
        : "Evidence needs human review.";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark light" />
  <title>${escapeHtml(data.productName)} · ${escapeHtml(data.scenarioLabel)} · ${escapeHtml(data.gateStatus)}</title>
  <style>
    :root{--ink:#132523;--paper:#f3f0e7;--panel:#fffdf7;--line:#d6d2c7;--muted:#66716f;--aqua:#39d5b5;--blue:#2c63ff;--red:#df5043;--amber:#e5a51b;--navy:#071b1d;--serif:Georgia,'Times New Roman',serif;--sans:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.5}a{color:inherit;text-decoration-thickness:1px;text-underline-offset:3px}a:hover{color:var(--blue)}code{font:500 .75rem ui-monospace,SFMono-Regular,Consolas,monospace;background:#edf0ea;border-radius:.3rem;padding:.15rem .32rem;overflow-wrap:anywhere}
    .topbar{background:var(--navy);color:white;border-bottom:1px solid #234143;position:sticky;top:0;z-index:10}.topbar__inner{max-width:1240px;margin:auto;display:flex;align-items:center;gap:1.5rem;padding:.8rem 1.4rem}.brand{font-weight:850;letter-spacing:-.04em;font-size:1.15rem;margin-right:auto}.brand i{display:inline-block;width:.62rem;height:.62rem;background:var(--aqua);border-radius:50%;margin-right:.55rem;box-shadow:0 0 0 .22rem #39d5b522}.topbar a{color:#c9d5d3;text-decoration:none;font-size:.82rem}.topbar a:hover{color:white}.mode{border:1px solid #42605f;border-radius:999px;padding:.25rem .55rem;color:#d8e3e1;font-size:.7rem;text-transform:uppercase;letter-spacing:.08em}
    main{max-width:1240px;margin:auto;padding:0 1.4rem 5rem}.hero{display:grid;grid-template-columns:1.35fr .65fr;gap:2rem;padding:5rem 0 2.5rem;border-bottom:1px solid var(--line)}.kicker,.eyebrow{font-size:.7rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);font-weight:760}.hero h1{font:500 clamp(3.2rem,7vw,6.7rem)/.88 var(--serif);letter-spacing:-.065em;margin:.45rem 0 1.25rem;max-width:850px}.hero__copy{font-size:1.05rem;color:#465451;max-width:700px}.decision{background:var(--navy);color:white;border-radius:1rem;padding:1.35rem;align-self:end;box-shadow:0 18px 50px #0a24242a}.decision--pass{border-top:5px solid var(--aqua)}.decision--fail{border-top:5px solid var(--red)}.decision--manual-review{border-top:5px solid var(--amber)}.decision small{display:block;text-transform:uppercase;letter-spacing:.12em;color:#9fb2b0}.decision strong{font:500 3.1rem/1 var(--serif);display:block;margin:.55rem 0}.decision p{color:#c8d3d1;font-size:.86rem;margin-bottom:0}
    .metrics{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--line)}.metric{padding:1.3rem 1rem 1.5rem 0;border-right:1px solid var(--line);margin:0 1rem 0 0}.metric:last-child{border:0}.metric p,.metric span{font-size:.72rem;color:var(--muted);display:block;margin:0}.metric strong{font:500 2.1rem var(--serif);display:block;margin:.2rem 0}
    .section{padding:4rem 0 0}.section__head{display:flex;align-items:end;justify-content:space-between;gap:1rem;margin-bottom:1.3rem}.section__head h2{font:500 clamp(2rem,4vw,3.5rem)/1 var(--serif);letter-spacing:-.045em;margin:.2rem 0}.section__head p{max-width:550px;color:var(--muted);margin:0}
    .criterion{background:var(--panel);border:1px solid var(--line);border-radius:.9rem;padding:1.25rem;margin:.8rem 0;box-shadow:0 4px 14px #17292708}.criterion__head{display:flex;justify-content:space-between;gap:1rem;align-items:start}.criterion h3{font:500 1.3rem/1.2 var(--serif);margin:.25rem 0}.criterion__why{color:#596461;margin:.8rem 0 1rem}.lanes{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:.65rem;overflow:hidden}.lanes section{background:#faf9f3;padding:.9rem}.lanes header{display:flex;align-items:center;gap:.55rem;border-bottom:1px solid var(--line);padding-bottom:.6rem;margin-bottom:.6rem}.lanes header>span:first-child{font:700 .68rem ui-monospace;color:var(--blue)}.lanes header strong{font-size:.78rem;margin-right:auto}.lanes ul{padding:0;margin:0;list-style:none}.lanes li{display:flex;flex-direction:column;gap:.2rem;padding:.45rem 0;font-size:.78rem;border-bottom:1px dashed #ddd9ce}.lanes li:last-child{border:0}.lanes li span{color:var(--muted)}.empty{color:#8d9491;font-style:italic}.missing{display:flex;align-items:center;flex-wrap:wrap;gap:.4rem;margin-top:.85rem}.missing strong{font-size:.72rem;text-transform:uppercase;letter-spacing:.1em;color:var(--red)}.missing span{font-size:.72rem;background:#fff0ec;color:#8b372f;padding:.25rem .45rem;border-radius:.3rem}
    .status{display:inline-flex;align-items:center;width:max-content;border:1px solid currentColor;border-radius:999px;padding:.16rem .48rem;font-size:.63rem;font-weight:800;text-transform:uppercase;letter-spacing:.065em;white-space:nowrap;color:#65706e}.status--verified,.status--supported,.status--passed,.status--pass,.status--current{color:#087c66;background:#e4f7f1}.status--unsupported,.status--contradicted,.status--failed,.status--fail,.status--source-error,.status--analysis-error{color:#a5362d;background:#ffebe6}.status--partially-verified,.status--partially-supported,.status--manual-review,.status--possibly-stale,.status--insufficient-sources{color:#8b5b00;background:#fff4d5}
    .source-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem}.source-card{background:var(--navy);color:white;border-radius:.85rem;padding:1rem;min-height:220px}.source-card__top{display:flex;justify-content:space-between}.source-number{font:700 .68rem ui-monospace;color:var(--aqua)}.source-card h3{font:500 1.25rem/1.2 var(--serif);margin:1.4rem 0 .5rem}.source-card p{font-size:.78rem;color:#afbfbd}.source-url{display:block;color:#a9bbb8;font:500 .67rem ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.source-card dl{font-size:.72rem}.source-card dl div{display:grid;grid-template-columns:5.6rem 1fr;gap:1rem;border-top:1px solid #284143;padding:.45rem 0}.source-card dt{color:#8ea3a0}.source-card dd{margin:0;overflow-wrap:anywhere}.source-card h4{font-size:.67rem;text-transform:uppercase;letter-spacing:.07em;color:#d8b362;margin:.7rem 0 .25rem}.source-card ul{margin:.2rem 0 .65rem;padding-left:1.1rem;color:#d5dfdd;font-size:.75rem}.source-card li{margin:.2rem 0;overflow-wrap:anywhere}.source-claims,.limitations{border-top:1px solid #284143;padding-top:.15rem}.source-claims--contradicted h4{color:#f0a096}.source-card .empty{margin:.2rem 0 .65rem}.source-card .status{background:transparent}
    .research{background:#e8ece6;border-left:4px solid var(--blue);padding:1.2rem 1.3rem;border-radius:0 .7rem .7rem 0}.research p{margin:0;max-width:1050px;white-space:pre-wrap}.research-boundary{margin:0 0 1rem;border:1px solid #8da5a0;background:#f8faf7;color:#344642;border-radius:.45rem;padding:.75rem .85rem;font-size:.8rem}.research-boundary strong{display:block;color:var(--ink);margin-bottom:.2rem}.inline-citation{display:inline-flex;align-items:baseline;margin:0 .18rem;color:#164fc4;font-size:.78em;font-weight:750;white-space:normal}.inline-citation:focus-visible,.source-card a:focus-visible{outline:3px solid var(--amber);outline-offset:3px}.inline-citation__url{display:none}.citation-warning{margin-top:1rem;border:1px solid #cc8d10;background:#fff4d5;color:#704b00;border-radius:.45rem;padding:.7rem .8rem;font-size:.78rem}.query-list{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.8rem}.query-list code{background:#dce2dc}
    .finding{display:grid;grid-template-columns:6.5rem 1fr;gap:1rem;border-top:1px solid var(--line);padding:1rem 0}.finding>span{font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;font-weight:800}.finding h3{font:500 1.15rem var(--serif);margin:0}.finding p{color:var(--muted);margin:.2rem 0}.finding--critical>span,.finding--high>span{color:var(--red)}
    .trust{background:#dedbd1;padding:1.2rem;border-radius:.7rem;color:#4e5956;font-size:.82rem}.footer{border-top:1px solid var(--line);margin-top:4rem;padding:1.5rem 0;color:var(--muted);display:flex;justify-content:space-between;font-size:.72rem}.hash{font:500 .68rem ui-monospace;overflow-wrap:anywhere}.empty-block{color:var(--muted);font-style:italic}.bad-link{color:var(--red)}
    @media(max-width:850px){.hero{grid-template-columns:1fr;padding-top:3rem}.metrics{grid-template-columns:1fr 1fr}.metric:nth-child(2){border-right:0}.lanes{grid-template-columns:1fr}.source-grid{grid-template-columns:1fr}.topbar a{display:none}}@media(max-width:520px){main{padding-inline:.85rem}.hero h1{font-size:3rem}.metrics{grid-template-columns:1fr}.metric{border-right:0}.criterion__head,.section__head{display:block}.section__head p{margin-top:.7rem}.finding{grid-template-columns:1fr}}
    @page{size:letter;margin:.5in}
    @media print{body{background:white}.topbar{position:static;background:white;color:var(--ink)}.topbar__inner{max-width:none;padding:.45rem 0}.topbar a{display:none}.brand,.mode{color:var(--ink)}.mode{border-color:var(--line)}main{max-width:none;padding:0}.hero{padding:1.25rem 0 1rem;gap:1rem}.hero h1{font-size:3.4rem}.decision{background:white;color:var(--ink);border:1px solid var(--line);box-shadow:none}.decision small,.decision p{color:var(--muted)}.section{padding-top:1.5rem}.section__head{break-inside:avoid-page;page-break-inside:avoid;break-after:avoid-page;page-break-after:avoid;margin-bottom:.7rem}.criterion,.source-card,.research-boundary,.finding,.trust,.footer{break-inside:avoid-page;page-break-inside:avoid;box-shadow:none}.source-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem}.source-card{background:white;color:black;border:1px solid #aaa;min-height:0;padding:.7rem}.source-card h3{font-size:1.05rem;margin:.7rem 0 .35rem}.source-card dl div{grid-template-columns:4.5rem 1fr;gap:.5rem;padding:.3rem 0}.source-card h4{margin:.45rem 0 .2rem}.source-card h3,.source-card h4,.source-card p,.source-card dt,.source-card dd,.source-card li,.source-url{color:#222}.source-title,.source-url{display:block!important}.source-url{text-decoration:none}.inline-citation__url{display:inline;overflow-wrap:anywhere}.inline-citation{color:#111;text-decoration:none}.trust{background:white;border:1px solid var(--line)}.footer{break-before:avoid-page;page-break-before:avoid;margin-top:1.5rem;padding:.75rem 0}}
  </style>
</head>
<body>
  <nav class="topbar" aria-label="Report sections"><div class="topbar__inner"><div class="brand"><i></i>${escapeHtml(data.productName)}</div><a href="#criteria">Criteria</a><a href="#sources">Sources</a><a href="#findings">Findings</a><span class="mode">${escapeHtml(data.sourceModeLabel)}</span></div></nav>
  <main>
    <header class="hero"><div><span class="kicker">Release evidence · ${escapeHtml(data.scenarioLabel)}</span><h1>${heroHeadline}</h1><p class="hero__copy">${escapeHtml(data.tagline)} This report keeps repository proof and external authority in separate lanes, then applies a deterministic release policy.</p></div><aside class="decision decision--${escapeHtml(gateClass)}"><small>Overall gate</small><strong>${escapeHtml(data.gateStatus)}</strong><p>${escapeHtml(data.gateExplanation)}</p></aside></header>
    <section class="metrics" aria-label="Summary metrics">${metric("Criteria verified", `${verified}/${data.criteria.length}`, `${requiredNonPassing} required non-passing`)}${metric("Executed checks", `${checksPassed}/${data.commandSummary.length}`, data.commandSummary.map((item) => `${item.name}: ${item.status}`).join(" · "))}${metric("External sources", String(data.sources.length), data.sourcePolicy)}${metric("Model", data.model, "Model assessment cannot override policy")}</section>
    <section class="section" id="criteria"><div class="section__head"><div><span class="eyebrow">Claim-to-evidence graph</span><h2>Criterion matrix</h2></div><p>Each criterion shows what the repository demonstrates, what authoritative sources state, and why the combined status follows.</p></div>${renderCriteriaRows(data)}</section>
    <section class="section" id="research"><div class="section__head"><div><span class="eyebrow">Bounded research narrative</span><h2>What the sources establish</h2></div></div><div class="research"><aside class="research-boundary" role="note"><strong>External research narrative — not the gate decision.</strong>This model-written text is untrusted evidence context. Only the deterministic Overall gate above controls the release result.</aside>${renderResearchNarrative(data)}<div class="query-list">${data.searchQueries.map((query) => `<code>${escapeHtml(query)}</code>`).join("")}</div></div></section>
    <section class="section" id="sources"><div class="section__head"><div><span class="eyebrow">Machine-validated registry</span><h2>External sources</h2></div><p>The registry retains every provider-returned source for provenance. Native-citation counts and claim associations distinguish cited support from other consulted records.</p></div><div class="source-grid">${renderSourceCards(data.sources)}</div></section>
    <section class="section" id="findings"><div class="section__head"><div><span class="eyebrow">Action queue</span><h2>Findings</h2></div></div>${renderFindings(data.findings)}</section>
    <section class="section"><div class="trust"><strong>Source trust disclosure.</strong> Citations establish what a source says; they do not independently prove the source is correct. Official sources can change, conflicting sources require human judgment, and external evidence does not prove implementation. High-stakes claims require qualified review.</div></section>
    <footer class="footer"><span>Generated ${escapeHtml(data.generatedAt)} · ${escapeHtml(data.taskTitle)}</span><span class="hash">SHA-256 ${escapeHtml(data.bundleHash)}</span></footer>
  </main>
</body>
</html>`;
}

export function writeStaticReport(outputPath: string, data: StaticReportData): string {
  const resolved = path.resolve(outputPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, renderStaticReport(data), "utf8");
  return resolved;
}

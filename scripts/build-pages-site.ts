import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

type GateStatus = "fail" | "pass";

interface BundleSummary {
  bundleHash: string;
  citationCount: number;
  gateStatus: GateStatus;
  gateSummary: string;
  generatedAt: string;
  model: string;
  sourceCount: number;
}

interface ScenarioSummary extends BundleSummary {
  description: string;
  label: string;
  slug: "incomplete" | "corrected";
}

export interface BuildPagesSiteOptions {
  demoDirectory: string;
  outputDirectory: string;
}

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedRoot = path.join(workspaceRoot, ".evidencegate");
const defaultDemoDirectory = path.join(workspaceRoot, ".evidencegate", "demo");
const defaultOutputDirectory = path.join(workspaceRoot, ".evidencegate", "pages");

const unsafeArtifactPatterns: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "OpenAI API key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/gu },
  { label: "Bearer token", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/giu },
  { label: "local file URL", pattern: /file:\/\/\//giu },
  { label: "Windows user path", pattern: /\b[A-Z]:[\\/]+Users[\\/]+/giu },
  { label: "macOS user path", pattern: /\/Users\/[A-Za-z0-9._-]+\//gu },
  { label: "Linux user or runner path", pattern: /\/home\/[A-Za-z0-9._-]+\//gu },
  { label: "executable script tag", pattern: /<script\b/giu },
];

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string.`);
  }
  return value;
}

function requiredCount(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label}.${key} must be a non-negative integer.`);
  }
  return value as number;
}

function readBundleSummary(bundlePath: string): BundleSummary {
  const bundle = asRecord(JSON.parse(readFileSync(bundlePath, "utf8")) as unknown, "bundle");
  const gate = asRecord(bundle["gate"], "bundle.gate");
  const researchRun = asRecord(
    Array.isArray(bundle["researchRuns"]) ? bundle["researchRuns"][0] : undefined,
    "bundle.researchRuns[0]",
  );
  const gateStatus = requiredString(gate, "status", "bundle.gate");
  if (gateStatus !== "fail" && gateStatus !== "pass") {
    throw new Error(`bundle.gate.status must be fail or pass, received ${gateStatus}.`);
  }
  const bundleHash = requiredString(bundle, "bundleHash", "bundle");
  if (!/^[a-f0-9]{64}$/u.test(bundleHash)) {
    throw new Error("bundle.bundleHash must be a lowercase SHA-256 value.");
  }
  return {
    bundleHash,
    citationCount: requiredCount(researchRun, "citationCount", "bundle.researchRuns[0]"),
    gateStatus,
    gateSummary: requiredString(gate, "summary", "bundle.gate"),
    generatedAt: requiredString(bundle, "generatedAt", "bundle"),
    model: requiredString(researchRun, "model", "bundle.researchRuns[0]"),
    sourceCount: requiredCount(researchRun, "sourceCount", "bundle.researchRuns[0]"),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function scenarioCard(scenario: ScenarioSummary): string {
  const statusLabel = scenario.gateStatus.toUpperCase();
  return `<article class="scenario scenario--${scenario.gateStatus}">
    <div class="scenario__topline">
      <span class="scenario__number">${scenario.slug === "incomplete" ? "01" : "02"}</span>
      <span class="pill pill--${scenario.gateStatus}">${statusLabel}</span>
    </div>
    <h3>${escapeHtml(scenario.label)}</h3>
    <p>${escapeHtml(scenario.description)}</p>
    <dl>
      <div><dt>Gate</dt><dd>${escapeHtml(scenario.gateSummary)}</dd></div>
      <div><dt>Source fixture</dt><dd>${scenario.sourceCount} records · ${scenario.citationCount} bound citations</dd></div>
      <div><dt>Bundle hash</dt><dd><code>${escapeHtml(scenario.bundleHash)}</code></dd></div>
    </dl>
    <div class="actions">
      <a class="button button--primary" href="./${scenario.slug}/report.html">Inspect ${statusLabel} report <span aria-hidden="true">↗</span></a>
      <a class="button" href="./${scenario.slug}/evidence-bundle.json" download>Download bundle</a>
    </div>
  </article>`;
}

export function renderLandingPage(scenarios: readonly ScenarioSummary[]): string {
  const incomplete = scenarios.find((scenario) => scenario.slug === "incomplete");
  const corrected = scenarios.find((scenario) => scenario.slug === "corrected");
  if (!incomplete || !corrected) throw new Error("Both demo scenarios are required.");
  if (incomplete.gateStatus !== "fail" || corrected.gateStatus !== "pass") {
    throw new Error("Pages demo requires the incomplete Fail and corrected Pass invariant.");
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Inspect EvidenceGate's deterministic Fail-to-Pass evidence demo without installing or rebuilding the project.">
  <meta name="color-scheme" content="dark">
  <title>EvidenceGate · Judge demo</title>
  <style>
    :root { color-scheme: dark; --ink: #f7f3e9; --muted: #a9b1b1; --line: #293536; --panel: #12191a; --panel-2: #172122; --lime: #c7f464; --red: #ff7369; --cyan: #73d4d1; --bg: #091011; }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body { margin: 0; background: radial-gradient(circle at 85% 0%, #173334 0, transparent 35rem), var(--bg); color: var(--ink); font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.55; }
    a { color: inherit; }
    .shell { width: min(1160px, calc(100% - 40px)); margin: 0 auto; }
    header { display: flex; align-items: center; justify-content: space-between; min-height: 76px; border-bottom: 1px solid var(--line); }
    .brand { display: flex; align-items: center; gap: 11px; font-weight: 760; letter-spacing: -.02em; }
    .brand i { width: 13px; height: 13px; border: 3px solid var(--lime); border-radius: 50%; box-shadow: 0 0 0 4px #c7f4641a; }
    nav { display: flex; gap: 24px; color: var(--muted); font-size: .92rem; }
    nav a { text-decoration: none; }
    nav a:hover { color: var(--ink); }
    .hero { padding: 84px 0 58px; display: grid; grid-template-columns: 1.35fr .85fr; gap: 64px; align-items: end; }
    .eyebrow { color: var(--lime); font: 700 .74rem/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: .15em; text-transform: uppercase; }
    h1 { margin: 18px 0 22px; max-width: 850px; font-size: clamp(3rem, 7vw, 6.3rem); line-height: .93; letter-spacing: -.065em; }
    .hero p { max-width: 720px; margin: 0; color: var(--muted); font-size: clamp(1.05rem, 2vw, 1.28rem); }
    .signal { border: 1px solid var(--line); border-radius: 18px; padding: 26px; background: linear-gradient(160deg, #172122e8, #0e1516e8); box-shadow: 0 24px 80px #0007; }
    .signal__row { display: grid; grid-template-columns: 1fr auto; gap: 20px; padding: 18px 0; border-bottom: 1px solid var(--line); }
    .signal__row:first-child { padding-top: 0; }
    .signal__row:last-child { padding-bottom: 0; border: 0; }
    .signal small { display: block; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
    .signal strong { display: block; margin-top: 4px; font-size: 1.15rem; }
    .status { align-self: center; font: 800 .78rem/1 ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: .1em; }
    .status--fail { color: var(--red); }
    .status--pass { color: var(--lime); }
    .notice { margin: 0 0 58px; padding: 16px 19px; display: flex; gap: 12px; align-items: flex-start; border: 1px solid #3e5958; background: #122021; color: #d4dedc; border-radius: 12px; }
    .notice strong { color: var(--cyan); white-space: nowrap; }
    .section-head { display: flex; justify-content: space-between; gap: 30px; align-items: end; margin-bottom: 24px; }
    h2 { margin: 8px 0 0; font-size: clamp(2rem, 4vw, 3.4rem); letter-spacing: -.045em; }
    .section-head p { max-width: 480px; margin: 0; color: var(--muted); }
    .scenarios { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .scenario { position: relative; overflow: hidden; padding: 30px; background: var(--panel); border: 1px solid var(--line); border-radius: 18px; }
    .scenario::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--red); }
    .scenario--pass::before { background: var(--lime); }
    .scenario__topline { display: flex; align-items: center; justify-content: space-between; }
    .scenario__number { color: #657273; font: 700 .78rem/1 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .pill { padding: 7px 10px; border: 1px solid currentColor; border-radius: 999px; font: 800 .72rem/1 ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing: .12em; }
    .pill--fail { color: var(--red); background: #ff736912; }
    .pill--pass { color: var(--lime); background: #c7f46412; }
    .scenario h3 { margin: 42px 0 10px; font-size: 1.75rem; letter-spacing: -.035em; }
    .scenario > p { min-height: 52px; color: var(--muted); }
    dl { margin: 26px 0; border-top: 1px solid var(--line); }
    dl div { display: grid; grid-template-columns: 120px 1fr; gap: 16px; padding: 13px 0; border-bottom: 1px solid var(--line); }
    dt { color: var(--muted); font-size: .82rem; }
    dd { margin: 0; font-size: .9rem; }
    code { word-break: break-all; color: #d8e8e5; font-size: .75rem; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 15px; border: 1px solid #405152; border-radius: 8px; color: #dce5e3; text-decoration: none; font-size: .86rem; font-weight: 700; }
    .button:hover { border-color: var(--cyan); }
    .button--primary { background: var(--ink); border-color: var(--ink); color: #0c1213; }
    .button--primary:hover { background: var(--lime); border-color: var(--lime); }
    .judge { padding: 86px 0; }
    .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin-top: 28px; overflow: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--line); }
    .step { min-height: 180px; padding: 25px; background: var(--panel-2); }
    .step span { color: var(--cyan); font: 700 .78rem/1 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .step h3 { margin: 32px 0 8px; }
    .step p { margin: 0; color: var(--muted); font-size: .92rem; }
    .contract { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding-bottom: 86px; }
    .lane { padding: 27px; border-top: 1px solid var(--line); background: linear-gradient(180deg, #12191a, transparent); }
    .lane b { color: var(--cyan); font: 700 .75rem/1 ui-monospace, SFMono-Regular, Consolas, monospace; text-transform: uppercase; letter-spacing: .12em; }
    .lane h3 { margin: 15px 0 8px; }
    .lane p { margin: 0; color: var(--muted); }
    footer { display: flex; justify-content: space-between; gap: 20px; padding: 25px 0 38px; border-top: 1px solid var(--line); color: var(--muted); font-size: .84rem; }
    footer a { color: var(--ink); }
    @media (max-width: 820px) { .hero, .scenarios, .contract { grid-template-columns: 1fr; } .hero { gap: 36px; padding-top: 58px; } .steps { grid-template-columns: 1fr; } .section-head { align-items: start; flex-direction: column; } nav a:not(:last-child) { display: none; } }
    @media (max-width: 520px) { .shell { width: min(100% - 24px, 1160px); } h1 { font-size: 3.25rem; } .scenario { padding: 24px; } dl div { grid-template-columns: 1fr; gap: 4px; } footer { flex-direction: column; } }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="brand"><i aria-hidden="true"></i>EvidenceGate</div>
      <nav aria-label="Primary">
        <a href="#reports">Reports</a>
        <a href="#judge">Judge path</a>
        <a href="https://github.com/harsh-choksi/EvidenceGate">GitHub ↗</a>
      </nav>
    </header>

    <main>
      <section class="hero">
        <div>
          <span class="eyebrow">OpenAI Build Week · Developer Tools</span>
          <h1>Evidence in two lanes. One inspectable gate.</h1>
          <p>EvidenceGate checks what a repository proves, what authoritative sources currently support, and where those two domains disagree before AI-generated code ships.</p>
        </div>
        <aside class="signal" aria-label="Fail to Pass summary">
          <div class="signal__row"><div><small>Incomplete patch</small><strong>Tests pass. Evidence does not.</strong></div><span class="status status--fail">FAIL</span></div>
          <div class="signal__row"><div><small>Corrected patch</small><strong>Both evidence domains agree.</strong></div><span class="status status--pass">PASS</span></div>
        </aside>
      </section>

      <aside class="notice"><strong>Cached validated fixture — not live web research</strong><span>This public judge demo uses a sanitized OpenAI response fixture. It makes no live web request and never presents cached evidence as live research.</span></aside>

      <section id="reports">
        <div class="section-head"><div><span class="eyebrow">Inspect the invariant</span><h2>Same task. Different evidence.</h2></div><p>Open each self-contained report, follow its official citations, and download the canonical JSON bundle behind the deterministic decision.</p></div>
        <div class="scenarios">${scenarios.map(scenarioCard).join("")}</div>
      </section>

      <section class="judge" id="judge">
        <div class="section-head"><div><span class="eyebrow">No-build judge path</span><h2>Review it in three moves.</h2></div><p>No installation, account, API key, or source rebuild is required for this path.</p></div>
        <div class="steps">
          <article class="step"><span>01 / FAIL</span><h3>Open the incomplete report</h3><p>See why a passing happy-path test cannot prove web search, source provenance, or safe clickable citations.</p></article>
          <article class="step"><span>02 / PASS</span><h3>Open the corrected report</h3><p>Inspect verified repository evidence beside supported external-source evidence for all fourteen required criteria.</p></article>
          <article class="step"><span>03 / VERIFY</span><h3>Download the bundles</h3><p>Compare the stored decision, source registry, assessments, model-run metadata, and canonical SHA-256 hash.</p></article>
        </div>
      </section>

      <section class="contract" aria-label="Evidence domains">
        <article class="lane"><b>Internal evidence</b><h3>What does this repository demonstrate?</h3><p>Diffs, source analysis, commands, tests, and runtime probes establish implementation facts—but cannot establish whether an external API remains current.</p></article>
        <article class="lane"><b>External evidence</b><h3>What do authoritative sources state?</h3><p>Allowed official documentation establishes current requirements—but never proves that this repository implemented them.</p></article>
      </section>
    </main>

    <footer><span>Code evidence, source evidence, and a release decision you can inspect.</span><span>Fixture model: ${escapeHtml(corrected.model)} · Generated ${escapeHtml(corrected.generatedAt.slice(0, 10))}</span></footer>
  </div>
</body>
</html>`;
}

function assertSafeContent(content: string, label: string): void {
  for (const unsafe of unsafeArtifactPatterns) {
    unsafe.pattern.lastIndex = 0;
    if (unsafe.pattern.test(content)) {
      throw new Error(`Refusing to publish ${unsafe.label} found in ${label}.`);
    }
  }
}

function assertSafeArtifact(filePath: string): void {
  assertSafeContent(readFileSync(filePath, "utf8"), filePath);
}

function assertSafeOutputDirectory(outputDirectory: string): void {
  const resolvedOutput = path.resolve(outputDirectory);
  const allowedPrefix = `${path.resolve(generatedRoot)}${path.sep}`;
  if (!resolvedOutput.startsWith(allowedPrefix)) {
    throw new Error(`Pages output must remain beneath ${generatedRoot}.`);
  }
}

function isWithinOrEqual(parentDirectory: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(parentDirectory), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  );
}

function assertNonOverlappingDirectories(demoDirectory: string, outputDirectory: string): void {
  if (
    isWithinOrEqual(demoDirectory, outputDirectory) ||
    isWithinOrEqual(outputDirectory, demoDirectory)
  ) {
    throw new Error("Pages demo input and output directories must not overlap.");
  }
}

export function buildPagesSite(options: BuildPagesSiteOptions): ScenarioSummary[] {
  assertSafeOutputDirectory(options.outputDirectory);
  assertNonOverlappingDirectories(options.demoDirectory, options.outputDirectory);
  const scenarios: ScenarioSummary[] = [
    {
      ...readBundleSummary(path.join(options.demoDirectory, "incomplete", "evidence-bundle.json")),
      description:
        "The happy-path test passes, but required web-search, provenance, citation rendering, and negative-test evidence is missing.",
      label: "Incomplete patch",
      slug: "incomplete",
    },
    {
      ...readBundleSummary(path.join(options.demoDirectory, "corrected", "evidence-bundle.json")),
      description:
        "Repository checks verify the implementation while validated official sources support the current external requirements.",
      label: "Corrected patch",
      slug: "corrected",
    },
  ];

  // Render first so a broken Fail-to-Pass invariant never replaces a previously valid site.
  const landingPage = renderLandingPage(scenarios);
  assertSafeContent(landingPage, "generated Pages landing page");
  for (const scenario of scenarios) {
    const sourceDirectory = path.join(options.demoDirectory, scenario.slug);
    for (const fileName of ["report.html", "evidence-bundle.json"] as const) {
      assertSafeArtifact(path.join(sourceDirectory, fileName));
    }
  }

  rmSync(options.outputDirectory, { force: true, recursive: true });
  mkdirSync(options.outputDirectory, { recursive: true });
  writeFileSync(path.join(options.outputDirectory, ".nojekyll"), "", "utf8");
  writeFileSync(path.join(options.outputDirectory, "index.html"), landingPage, "utf8");

  for (const scenario of scenarios) {
    const sourceDirectory = path.join(options.demoDirectory, scenario.slug);
    const targetDirectory = path.join(options.outputDirectory, scenario.slug);
    mkdirSync(targetDirectory, { recursive: true });
    for (const fileName of ["report.html", "evidence-bundle.json"] as const) {
      const sourcePath = path.join(sourceDirectory, fileName);
      cpSync(sourcePath, path.join(targetDirectory, fileName));
    }
  }
  return scenarios;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scenarios = buildPagesSite({
    demoDirectory: defaultDemoDirectory,
    outputDirectory: defaultOutputDirectory,
  });
  for (const scenario of scenarios) {
    console.log(`${scenario.label}: ${scenario.gateStatus.toUpperCase()} · ${scenario.bundleHash}`);
  }
  console.log(`GitHub Pages artifact: ${defaultOutputDirectory}`);
}

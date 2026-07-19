import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPagesSite, renderLandingPage } from "./build-pages-site.js";

const temporaryRoots: string[] = [];

function fixtureBundle(status: "fail" | "pass", hashCharacter: string): string {
  return JSON.stringify({
    bundleHash: hashCharacter.repeat(64),
    generatedAt: "2026-07-18T00:00:00.000Z",
    gate: { status, summary: `${status}: fixture summary` },
    researchRuns: [
      {
        citationCount: 2,
        model: "gpt-5.6 (cached fixture)",
        sourceCount: 2,
      },
    ],
  });
}

function createFixtureRoot(): { demoDirectory: string; outputDirectory: string } {
  const root = path.join(
    process.cwd(),
    ".evidencegate",
    `pages-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  temporaryRoots.push(root);
  const demoDirectory = path.join(root, "demo");
  const outputDirectory = path.join(root, "site");
  for (const scenario of ["incomplete", "corrected"] as const) {
    const directory = path.join(demoDirectory, scenario);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "report.html"), `<p>${scenario}</p>`, "utf8");
    writeFileSync(
      path.join(directory, "evidence-bundle.json"),
      fixtureBundle(
        scenario === "incomplete" ? "fail" : "pass",
        scenario === "incomplete" ? "a" : "b",
      ),
      "utf8",
    );
  }
  return { demoDirectory, outputDirectory };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("GitHub Pages site builder", () => {
  it("publishes self-contained Fail and Pass reports with downloadable bundles", () => {
    const options = createFixtureRoot();
    const scenarios = buildPagesSite(options);

    expect(scenarios.map((scenario) => scenario.gateStatus)).toEqual(["fail", "pass"]);
    const page = readFileSync(path.join(options.outputDirectory, "index.html"), "utf8");
    expect(page).toContain("Cached validated fixture");
    expect(page).toContain("./incomplete/report.html");
    expect(page).toContain("./corrected/evidence-bundle.json");
    expect(page).not.toContain("<script");
    expect(readdirSync(options.outputDirectory).sort()).toEqual([
      ".nojekyll",
      "corrected",
      "incomplete",
      "index.html",
    ]);
    expect(readdirSync(path.join(options.outputDirectory, "incomplete")).sort()).toEqual([
      "evidence-bundle.json",
      "report.html",
    ]);
    expect(
      readFileSync(path.join(options.outputDirectory, "corrected", "report.html"), "utf8"),
    ).toContain("corrected");
  });

  it("rejects a site when the required Fail-to-Pass invariant is reversed", () => {
    expect(() =>
      renderLandingPage([
        {
          bundleHash: "a".repeat(64),
          citationCount: 1,
          description: "fixture",
          gateStatus: "pass",
          gateSummary: "pass",
          generatedAt: "2026-07-18T00:00:00.000Z",
          label: "Incomplete patch",
          model: "fixture",
          slug: "incomplete",
          sourceCount: 1,
        },
        {
          bundleHash: "b".repeat(64),
          citationCount: 1,
          description: "fixture",
          gateStatus: "fail",
          gateSummary: "fail",
          generatedAt: "2026-07-18T00:00:00.000Z",
          label: "Corrected patch",
          model: "fixture",
          slug: "corrected",
          sourceCount: 1,
        },
      ]),
    ).toThrow(/Fail and corrected Pass invariant/u);
  });

  it("refuses to publish generated artifacts containing local machine paths", () => {
    const options = createFixtureRoot();
    writeFileSync(
      path.join(options.demoDirectory, "incomplete", "report.html"),
      "file:///C:/Users/example/report.html",
      "utf8",
    );
    expect(() => buildPagesSite(options)).toThrow(/local file URL/u);
  });

  it.each([
    ["literal Windows user path", String.raw`C:\Users\example\report.html`],
    ["JSON-escaped Windows user path", String.raw`C:\\Users\\example\\report.html`],
    ["forward-slash Windows user path", "C:/Users/example/report.html"],
    ["macOS user path", "/Users/example/work/EvidenceGate/report.html"],
    ["Linux runner path", "/home/runner/work/EvidenceGate/report.html"],
  ])("refuses to publish a %s", (_label, unsafePath) => {
    const options = createFixtureRoot();
    writeFileSync(
      path.join(options.demoDirectory, "incomplete", "report.html"),
      unsafePath,
      "utf8",
    );
    expect(() => buildPagesSite(options)).toThrow(/user|runner path/u);
  });

  it.each(["equal", "descendant", "ancestor"] as const)(
    "refuses an output directory that is an %s of the demo input",
    (relationship) => {
      const options = createFixtureRoot();
      const outputDirectory =
        relationship === "equal"
          ? options.demoDirectory
          : relationship === "descendant"
            ? path.join(options.demoDirectory, "published")
            : path.dirname(options.demoDirectory);
      expect(() => buildPagesSite({ ...options, outputDirectory })).toThrow(/must not overlap/u);
    },
  );

  it("refuses to replace an output directory outside the generated-artifact root", () => {
    const options = createFixtureRoot();
    expect(() =>
      buildPagesSite({
        ...options,
        outputDirectory: path.join(process.cwd(), "site"),
      }),
    ).toThrow(/must remain beneath/u);
  });
});

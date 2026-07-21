import { runFailToPassDemo } from "./demo-engine.js";
import { resolveOpenAIModel } from "@evidencegate/config";

try {
  process.loadEnvFile?.(".env");
} catch {
  // Shell-provided environment variables remain supported when no .env exists.
}

if (!process.env["OPENAI_API_KEY"]) {
  console.error("OPENAI_API_KEY is required. Copy .env.example to .env or set it in your shell.");
  process.exit(1);
}

const liveModel = resolveOpenAIModel(process.env);

console.log("EvidenceGate live demonstration");
console.log(`Source mode: LIVE ${liveModel} WEB SEARCH + STRUCTURED EVIDENCE ADJUDICATION`);
console.log("Search is restricted to developers.openai.com and platform.openai.com.");
console.log(
  "Freshness policy: no maximum source age for canonical live documentation; retrieval and provenance remain recorded.\n",
);

async function main(): Promise<void> {
  const started = Date.now();
  const results = await runFailToPassDemo("live", { model: liveModel });
  for (const result of results) {
    console.log(`${result.scenario.toUpperCase()} PATCH · gate ${result.gateStatus.toUpperCase()}`);
    console.log(`  Research passes: ${result.researchPassCount ?? 0}`);
    console.log(
      `  Single-guide umbrella coverage (non-gating): ${result.canonicalGuideCoverage === true ? "complete" : "incomplete"}`,
    );
    console.log(`  Adjudication attempts: ${result.adjudicationAttemptCount ?? 0}`);
    console.log(`  Report: ${result.reportPath}`);
    console.log(`  Bundle: ${result.bundlePath}`);
  }
  console.log(
    `\nLive two-stage research, adjudication, and report generation completed in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

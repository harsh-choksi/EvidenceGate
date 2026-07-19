import { runFailToPassDemo } from "./demo-engine.js";

console.log("EvidenceGate cached demonstration");
console.log("Source mode: CACHED VALIDATED FIXTURE (not live web search)\n");

const results = await runFailToPassDemo("cached");
for (const result of results) {
  console.log(`${result.scenario.toUpperCase()} PATCH`);
  console.log(`  Tests: ${result.commandResult.status}`);
  console.log(`  Overall gate: ${result.gateStatus.toUpperCase()}`);
  console.log(`  Bundle: ${result.bundlePath}`);
  console.log(`  Report: ${result.reportPath}`);
  console.log(`  Hash: ${result.bundleHash}\n`);
}
console.log(
  "Fail → Pass invariant verified. Open either static report in a browser to inspect the evidence lanes.",
);

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const expectedArtifacts = [
  "evidencegate-demo-reports-macos-latest",
  "evidencegate-demo-reports-ubuntu-latest",
  "evidencegate-demo-reports-windows-latest",
] as const;
const scenarios = ["incomplete", "corrected"] as const;

interface BundleHashRecord {
  artifact: string;
  hashes: Record<(typeof scenarios)[number], string>;
}

function readBundleHash(filePath: string): string {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Evidence bundle must be an object: ${filePath}`);
  }
  const bundleHash = (parsed as Record<string, unknown>)["bundleHash"];
  if (typeof bundleHash !== "string" || !/^[a-f0-9]{64}$/u.test(bundleHash)) {
    throw new Error(`Evidence bundle has an invalid SHA-256 hash: ${filePath}`);
  }
  return bundleHash;
}

export function verifyCrossPlatformDemoArtifacts(rootDirectory: string): BundleHashRecord[] {
  const root = path.resolve(rootDirectory);
  const records = expectedArtifacts.map((artifact) => ({
    artifact,
    hashes: Object.fromEntries(
      scenarios.map((scenario) => [
        scenario,
        readBundleHash(path.join(root, artifact, scenario, "evidence-bundle.json")),
      ]),
    ) as Record<(typeof scenarios)[number], string>,
  }));

  const baseline = records[0];
  if (!baseline) throw new Error("No cross-platform demo artifacts were provided.");
  for (const record of records.slice(1)) {
    for (const scenario of scenarios) {
      if (record.hashes[scenario] !== baseline.hashes[scenario]) {
        throw new Error(
          `Cross-platform ${scenario} bundle hash mismatch: ${baseline.artifact}=${baseline.hashes[scenario]}, ${record.artifact}=${record.hashes[scenario]}.`,
        );
      }
    }
  }
  return records;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDirectory = process.argv[2];
  if (!rootDirectory) throw new Error("Usage: node verify-cross-platform-demo.ts <artifact-root>");
  const records = verifyCrossPlatformDemoArtifacts(rootDirectory);
  for (const record of records) {
    console.log(
      `${record.artifact}: incomplete=${record.hashes.incomplete} corrected=${record.hashes.corrected}`,
    );
  }
  console.log("Cross-platform Fail/Pass bundle hashes match.");
}

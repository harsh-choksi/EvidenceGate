import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyCrossPlatformDemoArtifacts } from "./verify-cross-platform-demo.js";

const temporaryRoots: string[] = [];
const artifacts = [
  "evidencegate-demo-reports-macos-latest",
  "evidencegate-demo-reports-ubuntu-latest",
  "evidencegate-demo-reports-windows-latest",
] as const;

function createArtifacts(
  overrides: Partial<Record<(typeof artifacts)[number], string>> = {},
): string {
  const root = path.join(
    process.cwd(),
    ".evidencegate",
    `cross-platform-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  temporaryRoots.push(root);
  for (const artifact of artifacts) {
    for (const scenario of ["incomplete", "corrected"] as const) {
      const directory = path.join(root, artifact, scenario);
      mkdirSync(directory, { recursive: true });
      const hash = overrides[artifact] ?? (scenario === "incomplete" ? "a" : "b").repeat(64);
      writeFileSync(
        path.join(directory, "evidence-bundle.json"),
        JSON.stringify({ bundleHash: hash }),
      );
    }
  }
  return root;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("cross-platform demo verification", () => {
  it("accepts matching hashes from every required platform artifact", () => {
    expect(verifyCrossPlatformDemoArtifacts(createArtifacts())).toHaveLength(3);
  });

  it("rejects a platform-specific bundle hash", () => {
    const root = createArtifacts({
      "evidencegate-demo-reports-windows-latest": "c".repeat(64),
    });
    expect(() => verifyCrossPlatformDemoArtifacts(root)).toThrow(/hash mismatch/u);
  });

  it("rejects a missing required platform artifact", () => {
    const root = createArtifacts();
    const missingRoot = path.join(root, "evidencegate-demo-reports-windows-latest");
    rmSync(missingRoot, { force: true, recursive: true });
    expect(() => verifyCrossPlatformDemoArtifacts(root)).toThrow(/ENOENT/u);
  });

  it("rejects a malformed stored bundle hash", () => {
    const root = createArtifacts();
    writeFileSync(
      path.join(
        root,
        "evidencegate-demo-reports-ubuntu-latest",
        "corrected",
        "evidence-bundle.json",
      ),
      JSON.stringify({ bundleHash: "not-a-hash" }),
    );
    expect(() => verifyCrossPlatformDemoArtifacts(root)).toThrow(/invalid SHA-256/u);
  });
});

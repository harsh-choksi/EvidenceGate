import { execFileSync } from "node:child_process";

console.log("EvidenceGate release preparation runs verification without publishing or submitting.");
execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", ["verify"], {
  stdio: "inherit",
});
console.log(
  "Verification complete. Review docs/SUBMISSION_CHECKLIST.md before any manual release.",
);

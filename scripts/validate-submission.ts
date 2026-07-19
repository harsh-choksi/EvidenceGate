import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "README.md",
  "LICENSE",
  "AGENTS.md",
  "docs/HACKATHON_REQUIREMENTS.md",
  "docs/ARCHITECTURE.md",
  "docs/CODEX_USAGE.md",
  "docs/DEMO_SCRIPT.md",
  "docs/DEVPOST_SUBMISSION_DRAFT.md",
  "docs/SUBMISSION_CHECKLIST.md",
  "fixtures/demo-task.json",
];

const secretPatterns: Array<{ label: string; pattern: RegExp }> = [
  { label: "OpenAI API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/gu },
  { label: "private key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/gu },
  {
    label: "credential-bearing URL",
    pattern: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s:@/]+:[^\s@/]+@/giu,
  },
];

const excluded = new Set([
  ".agents",
  ".codex",
  ".git",
  ".evidencegate",
  ".pnpm-store",
  "node_modules",
  "dist",
  "coverage",
]);

function walk(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    if (excluded.has(name)) continue;
    const absolute = path.join(directory, name);
    const stats = statSync(absolute);
    if (stats.isDirectory()) files.push(...walk(absolute));
    else if (stats.isFile() && stats.size <= 1_000_000) files.push(absolute);
  }
  return files;
}

const failures: string[] = [];
for (const file of requiredFiles) {
  if (!existsSync(path.join(root, file))) failures.push(`Missing required file: ${file}`);
}

for (const file of walk(root)) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  if (/\.(?:png|jpg|jpeg|gif|ico|woff2?|zip|pdf)$/iu.test(relative)) continue;
  const content = readFileSync(file, "utf8");
  for (const secret of secretPatterns) {
    secret.pattern.lastIndex = 0;
    if (secret.pattern.test(content)) failures.push(`Possible ${secret.label} in ${relative}`);
  }
}

const pending: string[] = [];
const checklistPath = path.join(root, "docs", "SUBMISSION_CHECKLIST.md");
if (existsSync(checklistPath)) {
  const checklist = readFileSync(checklistPath, "utf8");
  const pendingCount = (checklist.match(/^- \[ \]/gmu) ?? []).length;
  if (pendingCount > 0)
    pending.push(`${pendingCount} submission checklist item(s) remain intentionally pending`);
}

if (failures.length > 0) {
  console.error("Submission validation failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Submission repository checks passed (required files and secret scan).");
}
for (const item of pending) console.log(`Pending human action: ${item}.`);

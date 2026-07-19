import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

export type ChangedFileStatus = "added" | "modified" | "deleted" | "renamed" | "copied" | "unknown";

export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: ChangedFileStatus;
}

export interface RepositorySnapshot {
  repositoryRoot: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  branch: string | null;
  isDirty: boolean;
  changedFiles: ChangedFile[];
  diff: string;
  diffBytes: number;
  diffTruncated: boolean;
  capturedAt: string;
}

export interface SnapshotOptions {
  baseRef: string;
  headRef?: string;
  maxDiffBytes?: number;
}

export class GitCollectionError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitCollectionError";
  }
}

function runGit(cwd: string, args: string[], maxBuffer = 2_000_000): string {
  try {
    return execFileSync(
      "git",
      ["-c", `safe.directory=${cwd.replaceAll("\\", "/")}`, "-C", cwd, ...args],
      {
        encoding: "utf8",
        maxBuffer,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trimEnd();
  } catch (error) {
    const rawStderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? (error as { stderr?: unknown }).stderr
        : undefined;
    const stderr =
      typeof rawStderr === "string"
        ? rawStderr.trim()
        : Buffer.isBuffer(rawStderr)
          ? rawStderr.toString("utf8").trim()
          : "";
    throw new GitCollectionError(
      `git ${args[0] ?? "command"} failed${stderr ? `: ${stderr}` : ""}`,
      {
        cause: error,
      },
    );
  }
}

export function detectRepository(startPath = process.cwd()): string {
  const resolved = realpathSync(path.resolve(startPath));
  const root = runGit(resolved, ["rev-parse", "--show-toplevel"]);
  if (!root) {
    throw new GitCollectionError(`${resolved} is not inside a Git repository`);
  }
  return realpathSync(root);
}

export function parseNameStatus(output: string): ChangedFile[] {
  if (!output.trim()) return [];
  return output
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [rawStatus = "", firstPath = "", secondPath] = line.split("\t");
      const code = rawStatus[0];
      if (code === "R" || code === "C") {
        return {
          path: secondPath ?? firstPath,
          previousPath: firstPath,
          status: code === "R" ? "renamed" : "copied",
        };
      }
      const status: ChangedFileStatus =
        code === "A" ? "added" : code === "M" ? "modified" : code === "D" ? "deleted" : "unknown";
      return { path: firstPath, status };
    });
}

export function truncateUtf8(
  value: string,
  maxBytes: number,
): { value: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return { value, truncated: false };
  return {
    value: `${bytes.subarray(0, maxBytes).toString("utf8")}\n… [diff truncated by EvidenceGate]`,
    truncated: true,
  };
}

export function collectRepositorySnapshot(
  repositoryPath: string,
  options: SnapshotOptions,
): RepositorySnapshot {
  const repositoryRoot = detectRepository(repositoryPath);
  const headRef = options.headRef ?? "HEAD";
  const maxDiffBytes = options.maxDiffBytes ?? 500_000;
  const comparison = `${options.baseRef}...${headRef}`;
  const rawDiff = runGit(
    repositoryRoot,
    ["diff", "--no-ext-diff", "--unified=3", comparison],
    maxDiffBytes * 4,
  );
  const bounded = truncateUtf8(rawDiff, maxDiffBytes);
  const changedFiles = parseNameStatus(
    runGit(repositoryRoot, ["diff", "--no-ext-diff", "--name-status", comparison]),
  );
  const branchValue = runGit(repositoryRoot, ["branch", "--show-current"]);

  return {
    repositoryRoot,
    baseRef: options.baseRef,
    headRef,
    headSha: runGit(repositoryRoot, ["rev-parse", headRef]),
    branch: branchValue || null,
    isDirty: Boolean(runGit(repositoryRoot, ["status", "--porcelain=v1"])),
    changedFiles,
    diff: bounded.value,
    diffBytes: Buffer.byteLength(bounded.value, "utf8"),
    diffTruncated: bounded.truncated,
    capturedAt: new Date().toISOString(),
  };
}

import { spawn } from "node:child_process";

export interface CommandSpec {
  id: string;
  command: string;
  cwd: string;
  required: boolean;
  timeoutSeconds: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
}

export interface CommandResult {
  commandId: string;
  command: string;
  required: boolean;
  status: "passed" | "failed" | "timed_out" | "spawn_error";
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  startedAt: string;
  completedAt: string;
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/gu,
  /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s]+/giu,
];

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, "[REDACTED]"),
    value,
  );
}

function boundedAppend(
  current: Buffer,
  chunk: Buffer,
  limit: number,
): { value: Buffer; truncated: boolean } {
  if (current.byteLength >= limit) return { value: current, truncated: true };
  const remaining = limit - current.byteLength;
  return {
    value: Buffer.concat([current, chunk.subarray(0, remaining)]),
    truncated: chunk.byteLength > remaining,
  };
}

export async function runCommand(spec: CommandSpec): Promise<CommandResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const maxOutputBytes = spec.maxOutputBytes ?? 200_000;

  return await new Promise((resolve) => {
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const child = spawn(spec.command, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
    }, spec.timeoutSeconds * 1_000);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => {
      const next = boundedAppend(stdout, chunk, maxOutputBytes);
      stdout = next.value;
      truncated ||= next.truncated;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const next = boundedAppend(stderr, chunk, maxOutputBytes);
      stderr = next.value;
      truncated ||= next.truncated;
    });

    const finish = (exitCode: number | null, status: CommandResult["status"]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const completed = Date.now();
      resolve({
        commandId: spec.id,
        command: spec.command,
        required: spec.required,
        status,
        exitCode,
        durationMs: completed - started,
        stdout: redactSecrets(stdout.toString("utf8")),
        stderr: redactSecrets(stderr.toString("utf8")),
        outputTruncated: truncated,
        startedAt,
        completedAt: new Date(completed).toISOString(),
      });
    };

    child.on("error", () => finish(null, "spawn_error"));
    child.on("close", (code) =>
      finish(code, timedOut ? "timed_out" : code === 0 ? "passed" : "failed"),
    );
  });
}

export async function runCommands(specs: CommandSpec[]): Promise<CommandResult[]> {
  const results: CommandResult[] = [];
  for (const spec of specs) results.push(await runCommand(spec));
  return results;
}

#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Command, Option } from "commander";
import {
  TaskSpecificationSchema,
  gateStatusToExitCode,
  parseEvidenceBundle,
  type EvidenceBundle,
  type TaskSpecification,
} from "@evidencegate/core";
import { loadConfig } from "@evidencegate/config";
import { collectRepositorySnapshot } from "@evidencegate/git";
import { writeStaticReport } from "@evidencegate/report";
import { createOpenAIWebSearchProviderFromEnvironment } from "@evidencegate/source-research";
import {
  DEFAULT_BUNDLE_PATH,
  DEFAULT_SOURCE_RESULTS_PATH,
  buildSourcePlans,
  createApprovedSourceResultsArtifact,
  parseApprovedSourceResultsArtifact,
  runEvidenceGateWorkflow,
} from "@evidencegate/workflow";
import { runFailToPassDemo } from "../../../scripts/demo-engine.js";
import { reportDataFromBundle } from "./report-data.js";

const VERSION = "0.1.0";
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8")) as unknown;
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadLocalEnvironment(cwd: string): void {
  try {
    process.loadEnvFile?.(path.join(cwd, ".env"));
  } catch {
    // Shell-provided variables remain supported when no local .env exists.
  }
}

function taskFrom(cwd: string, file = "evidencegate.task.json"): TaskSpecification {
  return TaskSpecificationSchema.parse(readJson(path.resolve(cwd, file)));
}

function defaultBundlePath(cwd: string): string {
  return path.join(cwd, DEFAULT_BUNDLE_PATH);
}

function readBundle(cwd: string, file?: string): EvidenceBundle {
  return parseEvidenceBundle(readJson(path.resolve(cwd, file ?? defaultBundlePath(cwd))));
}

const program = new Command()
  .name("evidencegate")
  .description("Verify code evidence and external-source evidence before release.")
  .version(VERSION)
  .option("-C, --cwd <directory>", "repository directory", process.cwd())
  .showHelpAfterError();

program
  .command("init")
  .description("Create a strict EvidenceGate configuration in the repository.")
  .action(() => {
    const cwd = path.resolve(program.opts<{ cwd: string }>().cwd);
    const destination = path.join(cwd, ".evidencegate.yml");
    if (existsSync(destination)) throw new Error(`${destination} already exists.`);
    copyFileSync(path.join(workspaceRoot, ".evidencegate.example.yml"), destination);
    mkdirSync(path.join(cwd, ".evidencegate"), { recursive: true });
    console.log(`Created ${destination}`);
  });

program
  .command("doctor")
  .description("Check the local runtime, Git, configuration, and live-source readiness.")
  .action(() => {
    const cwd = path.resolve(program.opts<{ cwd: string }>().cwd);
    loadLocalEnvironment(cwd);
    const checks: Array<[string, boolean, string]> = [];
    checks.push([
      "Node.js >=20",
      Number(process.versions.node.split(".")[0]) >= 20,
      process.version,
    ]);
    try {
      const git = execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
      checks.push(["Git", true, git]);
    } catch (error) {
      checks.push(["Git", false, asError(error).message]);
    }
    try {
      loadConfig(cwd);
      checks.push([".evidencegate.yml", true, "valid"]);
    } catch (error) {
      checks.push([".evidencegate.yml", false, asError(error).message]);
    }
    checks.push([
      "Live OpenAI research",
      Boolean(process.env["OPENAI_API_KEY"]),
      process.env["OPENAI_API_KEY"] ? "API key present" : "optional API key absent",
    ]);
    for (const [name, passed, detail] of checks) {
      console.log(`${passed ? "✓" : "·"} ${name}: ${detail}`);
    }
  });

const task = program.command("task").description("Create and validate task specifications.");
task
  .command("new")
  .option("-o, --output <file>", "output file", "evidencegate.task.json")
  .description("Create an editable task specification.")
  .action((options: { output: string }) => {
    const cwd = path.resolve(program.opts<{ cwd: string }>().cwd);
    const output = path.resolve(cwd, options.output);
    if (existsSync(output)) throw new Error(`${output} already exists.`);
    const example = TaskSpecificationSchema.parse(
      readJson(path.join(workspaceRoot, "fixtures", "demo-task.json")),
    );
    writeJson(output, { ...example, repositoryPath: cwd, createdAt: new Date().toISOString() });
    console.log(`Created ${output}`);
  });
task
  .command("validate")
  .argument("[file]", "task JSON", "evidencegate.task.json")
  .description("Validate a task specification strictly.")
  .action((file: string) => {
    const cwd = path.resolve(program.opts<{ cwd: string }>().cwd);
    const parsed = taskFrom(cwd, file);
    console.log(`Valid task ${parsed.taskId}: ${parsed.acceptanceCriteria.length} criteria.`);
  });

program
  .command("capture")
  .option("--base <ref>", "base ref")
  .option("--head <ref>", "head ref", "HEAD")
  .option("-o, --output <file>", "snapshot JSON", ".evidencegate/repository-snapshot.json")
  .description("Capture a bounded Git comparison without invoking a model.")
  .action((options: { base?: string; head: string; output: string }) => {
    const cwd = path.resolve(program.opts<{ cwd: string }>().cwd);
    const config = existsSync(path.join(cwd, ".evidencegate.yml")) ? loadConfig(cwd) : undefined;
    const baseRef = options.base ?? config?.repository.baseRef;
    if (!baseRef) throw new Error("Provide --base or create .evidencegate.yml.");
    const snapshot = collectRepositorySnapshot(cwd, {
      baseRef,
      headRef: options.head,
      ...(config === undefined ? {} : { maxDiffBytes: config.analysis.maxDiffBytes }),
    });
    const output = path.resolve(cwd, options.output);
    writeJson(output, snapshot);
    console.log(`Captured ${snapshot.changedFiles.length} changed file(s) to ${output}`);
  });

const sources = program
  .command("sources")
  .description("Plan and run explicit external-source checks.");
for (const commandName of ["plan", "preview"] as const) {
  sources
    .command(commandName)
    .option("-t, --task <file>", "task JSON", "evidencegate.task.json")
    .option("--criterion <ids...>", "criteria to include in the visible plan")
    .description(
      commandName === "plan"
        ? "Generate a source-search plan without network access."
        : "Show the exact claims, queries, domains, and privacy boundary without searching.",
    )
    .action((options: { task: string; criterion?: string[] }) => {
      const cwd = path.resolve(program.opts<{ cwd: string }>().cwd);
      const parsedTask = taskFrom(cwd, options.task);
      const config = loadConfig(cwd);
      const plans = buildSourcePlans(parsedTask, config, {
        ...(options.criterion === undefined ? {} : { selectedCriterionIds: options.criterion }),
      });
      console.log(
        JSON.stringify(
          {
            model: config.analysis.model,
            repositoryContentIncluded: false,
            estimatedApiCalls: plans.length,
            sourceMode: parsedTask.sourceMode,
            previewRequired: config.sources.previewRequired,
            plans,
          },
          null,
          2,
        ),
      );
      console.log(
        `\nPreview only: ${plans.length} proposed API call(s); source mode: ${parsedTask.sourceMode}; repository code included: no.`,
      );
    });
}
sources
  .command("check")
  .requiredOption("--approve", "approve the displayed source plan")
  .option("-t, --task <file>", "task JSON", "evidencegate.task.json")
  .option("--criterion <ids...>", "criteria approved for requested mode")
  .option("-o, --output <file>", "research result", DEFAULT_SOURCE_RESULTS_PATH)
  .description("Run approved live OpenAI web searches using the configured domain policy.")
  .action(
    async (options: { approve: boolean; task: string; output: string; criterion?: string[] }) => {
      const cwd = path.resolve(program.opts<{ cwd: string }>().cwd);
      loadLocalEnvironment(cwd);
      const parsedTask = taskFrom(cwd, options.task);
      const config = loadConfig(cwd);
      if (parsedTask.sourceMode === "off") {
        throw new Error("sourceMode=off prohibits all external network searches.");
      }
      if (config.sources.mode === "off") {
        throw new Error(
          ".evidencegate.yml sources.mode=off prohibits all external network searches.",
        );
      }
      const plans = buildSourcePlans(parsedTask, config, {
        ...(options.criterion === undefined ? {} : { selectedCriterionIds: options.criterion }),
        forExecution: true,
      });
      if (!plans[0]) throw new Error("The task has no external or hybrid criteria.");
      const apiKey = process.env["OPENAI_API_KEY"];
      if (!apiKey) throw new Error("OPENAI_API_KEY is required for a live source check.");
      const provider = await createOpenAIWebSearchProviderFromEnvironment(
        {
          OPENAI_API_KEY: apiKey,
          RUN_LIVE_OPENAI_TESTS: "true",
        },
        { model: config.analysis.model },
      );
      console.log(
        JSON.stringify(
          {
            approved: true,
            model: config.analysis.model,
            repositoryContentIncluded: false,
            plans,
          },
          null,
          2,
        ),
      );
      const results = [];
      for (const plan of plans) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 90_000);
        timeout.unref();
        try {
          results.push(
            await provider.research(plan, {
              approved: options.approve,
              signal: controller.signal,
            }),
          );
        } finally {
          clearTimeout(timeout);
        }
      }
      const output = path.resolve(cwd, options.output);
      writeJson(output, createApprovedSourceResultsArtifact(parsedTask, config, plans, results));
      const sourceCount = results.reduce(
        (count, result) => count + result.registry.sources.length,
        0,
      );
      console.log(
        `Collected ${sourceCount} validated source(s) across ${results.length} approved claim(s) to ${output}`,
      );
    },
  );
sources
  .command("list")
  .option("-b, --bundle <file>", "evidence bundle")
  .description("List the validated external-source registry.")
  .action((options: { bundle?: string }) => {
    const cwd = path.resolve(program.opts<{ cwd: string }>().cwd);
    const bundle = readBundle(cwd, options.bundle);
    for (const source of bundle.externalSources) {
      console.log(
        `${source.sourceId}\t${source.freshnessStatus}\t${source.domain}\t${source.title}`,
      );
    }
  });
sources
  .command("inspect")
  .argument("<source-id>")
  .option("-b, --bundle <file>", "evidence bundle")
  .description("Inspect provenance, freshness, claims, and limitations for one source.")
  .action((sourceId: string, options: { bundle?: string }) => {
    const cwd = path.resolve(program.opts<{ cwd: string }>().cwd);
    const source = readBundle(cwd, options.bundle).externalSources.find(
      (candidate) => candidate.sourceId === sourceId,
    );
    if (!source) throw new Error(`Unknown source ID: ${sourceId}`);
    console.log(JSON.stringify(source, null, 2));
  });

program
  .command("analyze")
  .option("-t, --task <file>", "task JSON", "evidencegate.task.json")
  .option("--preview", "show commands and source plans without executing them")
  .addOption(
    new Option("--sources [mode]", "consume approved external-source results")
      .choices(["requested", "required"])
      .preset("requested"),
  )
  .option("--source-results <file>", "approved source-results artifact")
  .option("-o, --output <file>", "evidence bundle", DEFAULT_BUNDLE_PATH)
  .description("Capture Git evidence, run configured checks, and write a verified evidence bundle.")
  .action(
    async (options: {
      task: string;
      preview?: boolean;
      sources?: "requested" | "required";
      sourceResults?: string;
      output: string;
    }) => {
      const cwd = path.resolve(program.opts<{ cwd: string }>().cwd);
      const parsedTask = taskFrom(cwd, options.task);
      const config = loadConfig(cwd);
      if (options.preview) {
        const plans = buildSourcePlans(parsedTask, config);
        console.log(
          JSON.stringify(
            {
              repository: {
                path: path.resolve(cwd, parsedTask.repositoryPath),
                baseRef: parsedTask.baseRef,
                headRef: parsedTask.headRef,
                includePaths: parsedTask.includePaths ?? ["**"],
                excludePaths: [...(parsedTask.excludePaths ?? []), ...config.privacy.excludedPaths],
              },
              commands: Object.fromEntries(
                Object.entries(config.commands).filter(([, command]) => command.enabled),
              ),
              sources: {
                networkAccess: false,
                model: config.analysis.model,
                repositoryContentIncluded: false,
                plans,
              },
            },
            null,
            2,
          ),
        );
        return;
      }

      if (options.sources !== undefined && parsedTask.sourceMode === "off") {
        throw new Error("sourceMode=off prohibits consuming external-source results.");
      }
      const defaultSourceResults = path.resolve(cwd, DEFAULT_SOURCE_RESULTS_PATH);
      const sourceResultsPath =
        options.sourceResults === undefined
          ? defaultSourceResults
          : path.resolve(cwd, options.sourceResults);
      if (options.sourceResults !== undefined && !existsSync(sourceResultsPath)) {
        throw new Error(`Approved source-results artifact not found: ${sourceResultsPath}`);
      }
      const approvedSources = existsSync(sourceResultsPath)
        ? parseApprovedSourceResultsArtifact(readJson(sourceResultsPath), parsedTask, config)
        : undefined;
      const result = await runEvidenceGateWorkflow({
        cwd,
        task: parsedTask,
        config,
        ...(approvedSources === undefined ? {} : { approvedSources }),
        ...(options.sources === undefined ? {} : { sourceIntent: options.sources }),
      });
      const output = path.resolve(cwd, options.output);
      writeJson(output, result.bundle);
      console.log(`Wrote ${output}`);
      console.log(`${result.bundle.gate.status.toUpperCase()}: ${result.bundle.gate.summary}`);
      process.exitCode = gateStatusToExitCode(result.bundle.gate.status);
    },
  );

program
  .command("gate")
  .argument("[bundle]", "evidence bundle")
  .description("Display the deterministic gate decision and use its documented exit code.")
  .action((bundleFile?: string) => {
    const cwd = path.resolve(program.opts<{ cwd: string }>().cwd);
    const bundle = readBundle(cwd, bundleFile);
    console.log(`${bundle.gate.status.toUpperCase()}: ${bundle.gate.summary}`);
    process.exitCode = gateStatusToExitCode(bundle.gate.status);
  });

program
  .command("report")
  .argument("[bundle]", "evidence bundle")
  .option("-o, --output <file>", "standalone HTML")
  .description("Generate a standalone, printable HTML report from a verified bundle.")
  .action((bundleFile: string | undefined, options: { output?: string }) => {
    const cwd = path.resolve(program.opts<{ cwd: string }>().cwd);
    const config = existsSync(path.join(cwd, ".evidencegate.yml")) ? loadConfig(cwd) : undefined;
    const reportOutput =
      options.output ??
      path.join(config?.report.outputDirectory ?? ".evidencegate/reports", "report.html");
    const output = writeStaticReport(
      path.resolve(cwd, reportOutput),
      reportDataFromBundle(readBundle(cwd, bundleFile)),
    );
    console.log(`Wrote ${output}`);
  });

program
  .command("verify")
  .argument("<bundle>", "evidence bundle JSON")
  .description("Validate all references and verify the canonical SHA-256 bundle hash.")
  .action((bundleFile: string) => {
    const cwd = path.resolve(program.opts<{ cwd: string }>().cwd);
    const bundle = readBundle(cwd, bundleFile);
    console.log(`Verified bundle ${bundle.bundleId}: ${bundle.bundleHash}`);
  });

program
  .command("demo")
  .description("Run the reproducible cached Fail → Pass demonstration.")
  .action(async () => {
    const results = await runFailToPassDemo("cached");
    for (const result of results) {
      console.log(`${result.scenario}: ${result.gateStatus} · ${result.reportPath}`);
    }
  });

program
  .command("version")
  .description("Print the EvidenceGate version.")
  .action(() => console.log(VERSION));

try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(`EvidenceGate: ${asError(error).message}`);
  process.exitCode = 3;
}

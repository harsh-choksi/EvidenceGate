import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export interface AnalyzableCriterion {
  criterionId: string;
  text: string;
  required: boolean;
}

export interface InternalEvidenceRecord {
  evidenceId: string;
  criterionId: string;
  evidenceType: "source" | "test" | "configuration" | "documentation";
  path: string;
  description: string;
  excerpt: string;
  supports: boolean;
}

export interface InternalCriterionResult {
  criterionId: string;
  status: "verified" | "partially_verified" | "unsupported" | "contradicted" | "analysis_error";
  evidenceIds: string[];
  explanation: string;
  missingEvidence: string[];
}

export interface RepositoryAnalysis {
  filesScanned: number;
  evidence: InternalEvidenceRecord[];
  assessments: InternalCriterionResult[];
  warnings: string[];
}

interface SourceFile {
  relativePath: string;
  content: string;
}

interface CriterionRule {
  criterionId: string;
  description: string;
  patterns: RegExp[];
  minimumMatches?: number;
  partialPatterns?: RegExp[];
  testOnly?: boolean;
}

const RULES: CriterionRule[] = [
  {
    criterionId: "responses-api",
    description: "The implementation calls client.responses.create.",
    patterns: [/\.responses\.create\s*\(/u],
  },
  {
    criterionId: "web-search",
    description: "The Responses request enables the web_search tool.",
    patterns: [/type\s*:\s*["']web_search["']/u],
  },
  {
    criterionId: "official-domains",
    description: "The search tool configures an allowed-domain filter for official OpenAI docs.",
    patterns: [
      /OFFICIAL_OPENAI_DOMAINS\s*=\s*\[\s*["']developers\.openai\.com["']\s*,\s*["']platform\.openai\.com["']\s*,?\s*\]/u,
      /allowed_domains\s*:\s*OFFICIAL_OPENAI_DOMAINS/u,
    ],
    minimumMatches: 2,
  },
  {
    criterionId: "source-metadata",
    description: "The request asks for web-search sources and retains them in a source registry.",
    patterns: [
      /include\s*:\s*\[\s*["']web_search_call\.action\.sources["']\s*\]/u,
      /sourceRegistry\s*=\s*buildSourceRegistry\s*\(/u,
      /sources\s*:\s*\[\.\.\.sourceRegistry\.values\(\)\]/u,
    ],
    minimumMatches: 3,
  },
  {
    criterionId: "citation-annotations",
    description:
      "The implementation reads response output-text annotations and parses native URL citation fields.",
    patterns: [
      /const\s+annotations\s*=\s*outputText\?\.type\s*===\s*["']output_text["']\s*\?\s*outputText\.annotations\s*:\s*\[\]/u,
      /annotation\.type\s*===\s*["']url_citation["']/u,
      /annotation\.url/u,
      /annotation\.title/u,
      /annotation\.start_index/u,
      /annotation\.end_index/u,
    ],
  },
  {
    criterionId: "visible-citations",
    description: "The UI renders every citation in a visible citations region.",
    patterns: [
      /<aside\s+[^>]*aria-label=["']Citations["'][^>]*>/u,
      /citations\.map\s*\(/u,
      /<Citations\s+citations=/u,
    ],
    minimumMatches: 3,
    partialPatterns: [/<h2>Citations<\/h2>/u],
  },
  {
    criterionId: "clickable-citations",
    description: "Citations render as anchors with a source URL.",
    patterns: [/<a\s+[^>]*href=/u],
  },
  {
    criterionId: "url-schemes",
    description: "Source URLs are parsed and restricted to HTTP(S).",
    patterns: [/new URL\s*\(/u, /https?:/u, /protocol/u],
    minimumMatches: 3,
  },
  {
    criterionId: "source-identifiers",
    description: "Citation URLs or identifiers are checked against the API-returned registry.",
    patterns: [/(?:returned|sourceRegistry|sourceUrls|knownSources)/u, /\.(?:has|get)\s*\(/u],
    minimumMatches: 2,
  },
  {
    criterionId: "untrusted-content",
    description: "Repository and retrieved content are explicitly treated as untrusted evidence.",
    patterns: [/untrusted/iu, /evidence, not instructions/iu],
    minimumMatches: 2,
  },
  {
    criterionId: "test-cited-response",
    description: "Tests exercise a successfully cited response.",
    patterns: [/(?:cited response|valid citations?|successful citations?)/iu],
    testOnly: true,
  },
  {
    criterionId: "test-no-source",
    description: "Tests exercise a response without sources.",
    patterns: [/(?:no[- ]source|missing source|without sources)/iu],
    testOnly: true,
  },
  {
    criterionId: "test-invalid-url",
    description: "Tests exercise malicious or unsupported URL schemes.",
    patterns: [/(?:javascript:|data:|unsupported URL|invalid URL)/iu],
    testOnly: true,
  },
  {
    criterionId: "test-fabricated-source",
    description: "Tests exercise a fabricated source reference.",
    patterns: [/(?:fabricated|unknown source|not returned)/iu],
    testOnly: true,
  },
];

const INCLUDED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".md", ".json"]);
const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage", ".evidencegate"]);

function walk(root: string, current = root): SourceFile[] {
  const files: SourceFile[] = [];
  const entries = readdirSync(current).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const entry of entries) {
    if (EXCLUDED_DIRECTORIES.has(entry)) continue;
    const absolute = path.join(current, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      files.push(...walk(root, absolute));
    } else if (
      stats.isFile() &&
      INCLUDED_EXTENSIONS.has(path.extname(entry)) &&
      stats.size <= 500_000
    ) {
      files.push({
        relativePath: path.relative(root, absolute).replaceAll("\\", "/"),
        content: readFileSync(absolute, "utf8"),
      });
    }
  }
  return files;
}

function excerptFor(content: string, pattern: RegExp): string {
  const match = pattern.exec(content);
  if (!match || match.index === undefined) return "";
  const start = Math.max(0, match.index - 70);
  const end = Math.min(content.length, match.index + match[0].length + 120);
  return content.slice(start, end).replace(/\s+/gu, " ").trim();
}

function evidenceId(criterionId: string, filePath: string, excerpt: string): string {
  return `ev_${createHash("sha256").update(`${criterionId}\0${filePath}\0${excerpt}`).digest("hex").slice(0, 16)}`;
}

function evaluateRule(
  rule: CriterionRule,
  files: SourceFile[],
): InternalCriterionResult & { evidence: InternalEvidenceRecord[] } {
  const eligible = rule.testOnly
    ? files.filter((file) =>
        /(?:^|\/)(?:test|tests|__tests__)(?:\/|\.)|\.(?:test|spec)\./u.test(file.relativePath),
      )
    : files;
  const matches: Array<{ file: SourceFile; pattern: RegExp }> = [];

  for (const pattern of rule.patterns) {
    const file = eligible.find((candidate) => pattern.test(candidate.content));
    if (file) matches.push({ file, pattern });
  }

  const needed = rule.minimumMatches ?? rule.patterns.length;
  const isVerified = matches.length >= needed;
  const partialMatch =
    !isVerified &&
    (matches.length > 0 ||
      (rule.partialPatterns ?? []).some((pattern) =>
        eligible.some((file) => pattern.test(file.content)),
      ));

  const evidence = matches.map(({ file, pattern }) => {
    const excerpt = excerptFor(file.content, pattern);
    return {
      evidenceId: evidenceId(rule.criterionId, file.relativePath, excerpt),
      criterionId: rule.criterionId,
      evidenceType: rule.testOnly ? ("test" as const) : ("source" as const),
      path: file.relativePath,
      description: rule.description,
      excerpt,
      supports: true,
    };
  });

  return {
    criterionId: rule.criterionId,
    status: isVerified ? "verified" : partialMatch ? "partially_verified" : "unsupported",
    evidenceIds: evidence.map((item) => item.evidenceId),
    explanation: isVerified
      ? rule.description
      : partialMatch
        ? `Some related implementation was found, but the evidence is incomplete: ${rule.description}`
        : `No repository evidence established that ${rule.description.charAt(0).toLowerCase()}${rule.description.slice(1)}`,
    missingEvidence: isVerified ? [] : [rule.description],
    evidence,
  };
}

export function analyzeSourcedAnswerRepository(
  repositoryRoot: string,
  criteria: AnalyzableCriterion[],
): RepositoryAnalysis {
  const files = walk(path.resolve(repositoryRoot));
  const evidence: InternalEvidenceRecord[] = [];
  const assessments = criteria.map((criterion) => {
    const rule = RULES.find((candidate) => candidate.criterionId === criterion.criterionId);
    if (!rule) {
      return {
        criterionId: criterion.criterionId,
        status: "analysis_error" as const,
        evidenceIds: [],
        explanation: "No deterministic analyzer is registered for this criterion.",
        missingEvidence: ["A criterion-specific verification hint or analyzer"],
      };
    }
    const result = evaluateRule(rule, files);
    evidence.push(...result.evidence);
    return {
      criterionId: result.criterionId,
      status: result.status,
      evidenceIds: result.evidenceIds,
      explanation: result.explanation,
      missingEvidence: result.missingEvidence,
    };
  });

  return {
    filesScanned: files.length,
    evidence,
    assessments,
    warnings: [
      "Static pattern evidence is bounded and must be combined with executed checks; it is not formal verification.",
    ],
  };
}

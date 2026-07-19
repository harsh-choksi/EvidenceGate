export type RedactionKind =
  | "private_key"
  | "api_token"
  | "authorization_header"
  | "connection_string"
  | "credential_assignment"
  | "email_address"
  | "source_code";

export interface RedactionFinding {
  kind: RedactionKind;
  replacement: string;
}

export interface RedactionResult {
  text: string;
  findings: RedactionFinding[];
  redacted: boolean;
}

interface RedactionRule {
  kind: RedactionKind;
  pattern: RegExp;
  replace: (match: string, ...captures: string[]) => string;
}

const REDACTION_RULES: readonly RedactionRule[] = [
  {
    kind: "private_key",
    pattern:
      /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gu,
    replace: () => "[REDACTED PRIVATE KEY]",
  },
  {
    kind: "authorization_header",
    pattern: /\b(?:authorization\s*:\s*bearer|bearer)\s+[a-z0-9._~+/=-]{12,}/giu,
    replace: () => "Bearer [REDACTED TOKEN]",
  },
  {
    kind: "api_token",
    pattern:
      /\b(?:sk-(?:proj-|svcacct-)?[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|AKIA[0-9A-Z]{16}|eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/gu,
    replace: () => "[REDACTED TOKEN]",
  },
  {
    kind: "connection_string",
    pattern:
      /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/giu,
    replace: (match) => `${match.slice(0, match.indexOf("://") + 3)}[REDACTED CREDENTIALS]`,
  },
  {
    kind: "credential_assignment",
    pattern:
      /\b(api[_-]?key|client[_-]?secret|password|passwd|access[_-]?token|refresh[_-]?token|secret)\b\s*[:=]\s*["']?([^\s,"';}]{6,})["']?/giu,
    replace: (_match, name) => `${name}=[REDACTED]`,
  },
  {
    kind: "email_address",
    pattern: /\b[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/giu,
    replace: () => "[REDACTED EMAIL]",
  },
];

function replaceAndRecord(text: string, rule: RedactionRule, findings: RedactionFinding[]): string {
  return text.replace(rule.pattern, (...args: unknown[]) => {
    const match = String(args[0]);
    const captures = args.slice(1, -2).map(String);
    const replacement = rule.replace(match, ...captures);
    findings.push({ kind: rule.kind, replacement });
    return replacement;
  });
}

export interface RedactionOptions {
  redactEmails?: boolean;
  redactCodeBlocks?: boolean;
  maximumLength?: number;
}

export function redactSensitiveText(
  input: string,
  options: RedactionOptions = {},
): RedactionResult {
  const findings: RedactionFinding[] = [];
  let text = input.normalize("NFKC");

  if (options.redactCodeBlocks ?? false) {
    text = text.replace(/```[\s\S]*?```/gu, () => {
      findings.push({ kind: "source_code", replacement: "[REDACTED CODE]" });
      return "[REDACTED CODE]";
    });
  }

  for (const rule of REDACTION_RULES) {
    if (rule.kind === "email_address" && options.redactEmails === false) {
      continue;
    }
    text = replaceAndRecord(text, rule, findings);
  }

  text = text.replace(/\s+/gu, " ").trim();
  const maximumLength = options.maximumLength ?? 600;
  if (text.length > maximumLength) {
    text = `${text.slice(0, maximumLength - 1).trimEnd()}…`;
  }

  return { text, findings, redacted: findings.length > 0 };
}

export interface QueryPrivacyContext {
  privateIdentifiers?: readonly string[];
}

export function detectQueryPrivacyWarnings(
  query: string,
  context: QueryPrivacyContext = {},
): string[] {
  const warnings = new Set<string>();
  const redaction = redactSensitiveText(query, {
    redactEmails: true,
    redactCodeBlocks: true,
  });
  for (const finding of redaction.findings) {
    warnings.add(`Query contained ${finding.kind.replaceAll("_", " ")}.`);
  }

  if (
    /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})\b/u.test(
      query,
    )
  ) {
    warnings.add("Query contains a private network address.");
  }
  if (/\b[a-z0-9-]+\.(?:internal|intranet|local|corp)\b/iu.test(query)) {
    warnings.add("Query contains a private-looking hostname.");
  }
  if (/\b(?:at\s+\S+\s+\([^)]*:\d+:\d+\)|Traceback \(most recent call last\))/u.test(query)) {
    warnings.add("Query contains stack-trace content.");
  }
  if (/[{};]\s*(?:const|let|var|function|class|interface)\b/u.test(query)) {
    warnings.add("Query contains source-code-like content.");
  }

  const folded = query.toLocaleLowerCase();
  for (const identifier of context.privateIdentifiers ?? []) {
    const normalized = identifier.trim().toLocaleLowerCase();
    if (normalized.length >= 3 && folded.includes(normalized)) {
      warnings.add("Query contains a configured private identifier.");
      break;
    }
  }

  return [...warnings];
}

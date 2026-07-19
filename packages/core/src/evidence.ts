import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  JsonValueSchema,
  NonEmptyTextSchema,
  SeveritySchema,
  Sha256Schema,
  addDuplicateIssues,
  uniqueStringsSchema,
} from "./common.js";

export const FileChangeStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "untracked",
]);
export type FileChangeStatus = z.infer<typeof FileChangeStatusSchema>;

export const ChangedFileSchema = z
  .object({
    path: NonEmptyTextSchema,
    status: FileChangeStatusSchema,
    previousPath: NonEmptyTextSchema.optional(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    binary: z.boolean(),
  })
  .strict()
  .superRefine((file, context) => {
    if (file.status === "renamed" && file.previousPath === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Renamed files must include previousPath",
        path: ["previousPath"],
      });
    }
  });
export type ChangedFile = z.infer<typeof ChangedFileSchema>;

export const RepositorySnapshotSchema = z
  .object({
    repositoryPath: NonEmptyTextSchema,
    baseRef: NonEmptyTextSchema,
    headRef: NonEmptyTextSchema,
    headCommit: NonEmptyTextSchema.optional(),
    capturedAt: IsoDateTimeSchema,
    isDirty: z.boolean(),
    changedFiles: z.array(ChangedFileSchema),
    diffHash: Sha256Schema.optional(),
  })
  .strict()
  .superRefine((snapshot, context) => {
    addDuplicateIssues(
      snapshot.changedFiles.map((file) => file.path),
      context,
      ["changedFiles"],
      "changed file path",
    );
  });
export type RepositorySnapshot = z.infer<typeof RepositorySnapshotSchema>;

export const EvidenceKindSchema = z.enum([
  "git_diff",
  "source_file",
  "test_result",
  "build_result",
  "lint_result",
  "typecheck_result",
  "security_result",
  "runtime_probe",
  "dependency_manifest",
  "migration",
  "configuration",
  "documentation",
  "static_analysis",
  "other",
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceStatusSchema = z.enum([
  "passed",
  "failed",
  "warning",
  "informational",
  "unavailable",
  "not_run",
]);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

export const EvidenceItemSchema = z
  .object({
    evidenceId: IdentifierSchema,
    criterionIds: uniqueStringsSchema(),
    kind: EvidenceKindSchema,
    status: EvidenceStatusSchema,
    summary: NonEmptyTextSchema,
    details: z.string().optional(),
    required: z.boolean().optional(),
    command: NonEmptyTextSchema.optional(),
    filePath: NonEmptyTextSchema.optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    capturedAt: IsoDateTimeSchema.optional(),
    contentHash: Sha256Schema.optional(),
    metadata: z.record(JsonValueSchema).optional(),
  })
  .strict()
  .superRefine((evidence, context) => {
    const hasStart = evidence.startLine !== undefined;
    const hasEnd = evidence.endLine !== undefined;
    if (hasEnd && !hasStart) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endLine requires startLine",
        path: ["startLine"],
      });
    }

    if (
      evidence.startLine !== undefined &&
      evidence.endLine !== undefined &&
      evidence.endLine < evidence.startLine
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "endLine cannot precede startLine",
        path: ["endLine"],
      });
    }
  });
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const FindingSchema = z
  .object({
    findingId: IdentifierSchema,
    criterionIds: uniqueStringsSchema(),
    severity: SeveritySchema,
    category: NonEmptyTextSchema,
    title: NonEmptyTextSchema,
    description: NonEmptyTextSchema,
    evidenceIds: uniqueStringsSchema(),
    sourceIds: uniqueStringsSchema(),
    remediation: NonEmptyTextSchema.optional(),
  })
  .strict();
export type Finding = z.infer<typeof FindingSchema>;

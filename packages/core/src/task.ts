import { z } from "zod";

import {
  IdentifierSchema,
  IsoDateTimeSchema,
  NonEmptyTextSchema,
  addDuplicateIssues,
  uniqueStringsSchema,
} from "./common.js";
import { HostnameSchema, SourceModeSchema, SourcePolicySchema } from "./source.js";

export const CriterionCategorySchema = z.enum([
  "functionality",
  "security",
  "authorization",
  "testing",
  "performance",
  "reliability",
  "migration",
  "documentation",
  "accessibility",
  "api_compatibility",
  "standards",
  "external_fact",
  "other",
]);
export type CriterionCategory = z.infer<typeof CriterionCategorySchema>;

export const CriterionEvidenceDomainSchema = z.enum(["internal", "external", "hybrid", "auto"]);
export type CriterionEvidenceDomain = z.infer<typeof CriterionEvidenceDomainSchema>;

export const ExternalEvidenceRequirementSchema = z
  .object({
    mode: z.enum(["off", "requested", "required"]),
    sourcePolicy: SourcePolicySchema.optional(),
    allowedDomains: z.array(HostnameSchema).optional(),
    blockedDomains: z.array(HostnameSchema).optional(),
    maxSourceAgeDays: z.number().int().nonnegative().optional(),
    minimumSourceCount: z.number().int().positive().optional(),
    preferredPublishers: uniqueStringsSchema().optional(),
    userQuery: NonEmptyTextSchema.optional(),
  })
  .strict()
  .superRefine((requirement, context) => {
    const allowed = requirement.allowedDomains ?? [];
    const blocked = requirement.blockedDomains ?? [];
    addDuplicateIssues(allowed, context, ["allowedDomains"], "allowed domain");
    addDuplicateIssues(blocked, context, ["blockedDomains"], "blocked domain");

    const blockedSet = new Set(blocked);
    allowed.forEach((domain, index) => {
      if (blockedSet.has(domain)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Domain cannot be both allowed and blocked: ${domain}`,
          path: ["allowedDomains", index],
        });
      }
    });
  });
export type ExternalEvidenceRequirement = z.infer<typeof ExternalEvidenceRequirementSchema>;

export const AcceptanceCriterionSchema = z
  .object({
    criterionId: IdentifierSchema,
    text: NonEmptyTextSchema,
    category: CriterionCategorySchema,
    required: z.boolean(),
    evidenceDomain: CriterionEvidenceDomainSchema,
    verificationHints: uniqueStringsSchema().optional(),
    externalEvidence: ExternalEvidenceRequirementSchema.optional(),
  })
  .strict();
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const RiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

export const TaskSpecificationSchema = z
  .object({
    schemaVersion: z.literal(1),
    taskId: IdentifierSchema,
    title: NonEmptyTextSchema,
    problemStatement: NonEmptyTextSchema,
    acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
    baseRef: NonEmptyTextSchema,
    headRef: NonEmptyTextSchema,
    repositoryPath: NonEmptyTextSchema,
    createdAt: IsoDateTimeSchema,
    riskLevel: RiskLevelSchema.optional(),
    includePaths: uniqueStringsSchema().optional(),
    excludePaths: uniqueStringsSchema().optional(),
    sourceMode: SourceModeSchema,
    defaultSourcePolicy: SourcePolicySchema.optional(),
  })
  .strict()
  .superRefine((task, context) => {
    addDuplicateIssues(
      task.acceptanceCriteria.map((criterion) => criterion.criterionId),
      context,
      ["acceptanceCriteria"],
      "criterion ID",
    );
  });
export type TaskSpecification = z.infer<typeof TaskSpecificationSchema>;

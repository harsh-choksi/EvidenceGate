import { z } from "zod";

export const IdentifierSchema = z
  .string()
  .trim()
  .min(1, "ID cannot be empty")
  .max(256, "ID cannot exceed 256 characters")
  .regex(/^\S+$/, "ID cannot contain whitespace");

export const NonEmptyTextSchema = z.string().trim().min(1);

export const IsoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: "Expected an ISO 8601 date-time with a timezone" });

export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 digest");

export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

export function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }

  return [...duplicates].sort();
}

export function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: (string | number)[],
  label: string,
): void {
  for (const duplicate of findDuplicates(values)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate ${label}: ${duplicate}`,
      path,
    });
  }
}

export function uniqueStringsSchema(minimum = 0) {
  return z
    .array(NonEmptyTextSchema)
    .min(minimum)
    .superRefine((values, context) => addDuplicateIssues(values, context, [], "value"));
}

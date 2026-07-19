import { createHash } from "node:crypto";

import {
  EvidenceBundleSchema,
  UnsignedEvidenceBundleSchema,
  type EvidenceBundle,
  type UnsignedEvidenceBundle,
} from "./bundle.js";

function serializeCanonical(value: unknown, ancestors: Set<object>): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number": {
      if (!Number.isFinite(value)) {
        throw new TypeError("Canonical JSON cannot contain a non-finite number");
      }
      return JSON.stringify(value);
    }
    case "object": {
      if (ancestors.has(value)) {
        throw new TypeError("Canonical JSON cannot contain a cycle");
      }
      ancestors.add(value);

      try {
        if (Array.isArray(value)) {
          return `[${value.map((item) => serializeCanonical(item, ancestors)).join(",")}]`;
        }

        const prototype = Reflect.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          throw new TypeError("Canonical JSON accepts only plain objects and arrays");
        }

        const record = value as Record<string, unknown>;
        const entries = Object.keys(record)
          .filter((key) => record[key] !== undefined)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${serializeCanonical(record[key], ancestors)}`);
        return `{${entries.join(",")}}`;
      } finally {
        ancestors.delete(value);
      }
    }
    case "undefined":
    case "bigint":
    case "function":
    case "symbol":
      throw new TypeError(`Canonical JSON cannot contain ${typeof value}`);
  }

  throw new TypeError("Canonical JSON received an unsupported value");
}

export function canonicalStringify(value: unknown): string {
  return serializeCanonical(value, new Set<object>());
}

export function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
}

export function computeBundleHash(bundle: EvidenceBundle | UnsignedEvidenceBundle): string {
  const hashable: Partial<EvidenceBundle> = { ...bundle };
  delete hashable.bundleHash;
  return sha256Canonical(hashable);
}

export function createEvidenceBundle(input: UnsignedEvidenceBundle): EvidenceBundle {
  const parsed = UnsignedEvidenceBundleSchema.parse(input);
  return EvidenceBundleSchema.parse({
    ...parsed,
    bundleHash: computeBundleHash(parsed),
  });
}

export function verifyBundleHash(bundle: EvidenceBundle): boolean {
  const parsed = EvidenceBundleSchema.safeParse(bundle);
  return parsed.success && computeBundleHash(parsed.data) === parsed.data.bundleHash;
}

export function parseEvidenceBundle(input: unknown): EvidenceBundle {
  const bundle = EvidenceBundleSchema.parse(input);
  const expectedHash = computeBundleHash(bundle);
  if (bundle.bundleHash !== expectedHash) {
    throw new Error(
      `Evidence bundle hash mismatch: expected ${expectedHash}, received ${bundle.bundleHash}`,
    );
  }
  return bundle;
}

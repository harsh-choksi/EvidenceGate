import type { ExternalSourceRecord, SourceConflict } from "./types.js";

function normalizeClaim(claim: string): string {
  return claim
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function stableConflictId(claim: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < claim.length; index += 1) {
    hash ^= claim.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `conflict-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

interface ClaimSides {
  displayClaim: string;
  supportingSourceIds: Set<string>;
  contradictingSourceIds: Set<string>;
}

export function detectSourceConflicts(sources: readonly ExternalSourceRecord[]): SourceConflict[] {
  const byClaim = new Map<string, ClaimSides>();

  for (const source of sources) {
    for (const claim of source.claimsSupported) {
      const normalized = normalizeClaim(claim);
      if (normalized === "") continue;
      const sides = byClaim.get(normalized) ?? {
        displayClaim: claim.trim(),
        supportingSourceIds: new Set<string>(),
        contradictingSourceIds: new Set<string>(),
      };
      sides.supportingSourceIds.add(source.sourceId);
      byClaim.set(normalized, sides);
    }
    for (const claim of source.claimsContradicted) {
      const normalized = normalizeClaim(claim);
      if (normalized === "") continue;
      const sides = byClaim.get(normalized) ?? {
        displayClaim: claim.trim(),
        supportingSourceIds: new Set<string>(),
        contradictingSourceIds: new Set<string>(),
      };
      sides.contradictingSourceIds.add(source.sourceId);
      byClaim.set(normalized, sides);
    }
  }

  const conflicts: SourceConflict[] = [];
  for (const [normalizedClaim, sides] of byClaim) {
    const supportingSourceIds = [...sides.supportingSourceIds];
    const contradictingSourceIds = [...sides.contradictingSourceIds];
    if (supportingSourceIds.length === 0 || contradictingSourceIds.length === 0) {
      continue;
    }
    conflicts.push({
      conflictId: stableConflictId(normalizedClaim),
      normalizedClaim: sides.displayClaim,
      supportingSourceIds,
      contradictingSourceIds,
      reason:
        "Returned source evidence contains opposing assertions about the same normalized claim; authority, date, version, and jurisdiction require review.",
      requiresManualReview: true,
    });
  }

  return conflicts.sort((left, right) => left.conflictId.localeCompare(right.conflictId));
}

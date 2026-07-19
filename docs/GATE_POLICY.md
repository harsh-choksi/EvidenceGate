# Gate policy

EvidenceGate's release decision is deterministic, versionable, and inspectable. GPT-5.6 may classify claims and assess supplied evidence, but it never sets the gate result.

## Domain truth table

| Criterion domain | Passing condition                                                 | Non-passing examples                                                                    |
| ---------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `internal`       | internal status is `verified`                                     | partial, unsupported, contradicted, analysis error                                      |
| `external`       | external status is `supported` under the configured source policy | partial, unsupported, contradicted, conflict, insufficient sources, source error        |
| `hybrid`         | internal is `verified` **and** external is `supported`            | either domain is missing, partial, unsupported, contradicted, conflicting, or erroneous |

The hybrid rule is an AND, never a weighted average. Documentation cannot prove implementation, and code cannot establish that an external requirement is current.

## Criterion dispositions

Required criteria:

- `verified` passes.
- `partially_verified` fails by default.
- `unsupported` or `contradicted` fails by default.
- authoritative conflicts or partial external evidence require manual review when configured.
- invalid or missing analysis becomes `analysis_error`.
- a required provider/provenance failure becomes `source_error` when configured.

An optional criterion that is not verified creates a warning instead of a failure. Optional status never upgrades a required failure.

## Repository-wide blockers

The default policy also fails when a required configured command fails or is unavailable, or when a critical finding exists. Command evidence includes tests, build, lint, typecheck, security checks, and runtime probes.

Configured commands are operator-controlled executable input. Their successful exit status is evidence about the command that ran, not proof that the command was relevant or complete.

## Overall precedence

The gate resolves aggregate status in this order:

1. `analysis_error`
2. `source_error`
3. `fail`
4. `manual_review`
5. `pass_with_warnings`
6. `pass`

This precedence prevents a warning or passing criterion from masking a more fundamental inability to evaluate the change.

## Exit codes

| Gate status                  | Exit code |
| ---------------------------- | --------: |
| `pass`, `pass_with_warnings` |         0 |
| `fail`                       |         1 |
| `manual_review`              |         2 |
| `analysis_error`             |         3 |
| `source_error`               |         4 |

Consumers should parse the evidence bundle for details rather than infer individual criterion outcomes from the exit code alone.

## Default policy switches

The default configuration enables:

```yaml
gate:
  failOnUnsupportedRequiredCriterion: true
  failOnContradictedRequiredCriterion: true
  failOnRequiredCommandFailure: true
  failOnCriticalFinding: true
  external:
    failOnRequiredSourceError: true
    failOnRequiredExternalContradiction: true
    manualReviewOnConflictingSources: true
    requireBothDomainsForHybridClaims: true
```

Overrides must be explicit, validated, visible in the bundle/report, and must not fabricate evidence or relabel cached research as live. The hybrid invariant remains a repository requirement even if configuration is extended.

## Policy bundle versions

`deterministic-v2` is the current emitted policy version. It stores the complete resolved `gatePolicy` object in the evidence bundle, derives combined statuses under that policy, and requires verification to recompute the gate with the exact same inputs. Missing policy inputs, unsupported versions, rehashed policy tampering, and cross-layer assessment divergence are rejected.

`deterministic-v1` remains readable for default-policy-only bundles. A v1 bundle cannot smuggle configurable policy inputs; a v2 bundle cannot omit them. `requireBothDomainsForHybridClaims` is schema-locked to `true` in both current configuration and policy inputs.

## Inputs the policy trusts

The gate accepts only schema-valid task criteria, combined assessments, evidence items, and findings. Before policy evaluation, referenced criterion, evidence, citation, and source IDs must bind to records in their registries. Unknown IDs, duplicate identities, or corrupted bundle hashes are integrity failures, not low-confidence evidence.

## Determinism

For the same validated inputs and policy version, the gate result must be identical. Current time, model prose, source ordering, terminal color, and UI state cannot affect the decision. Timestamps and freshness are calculated at the boundary and stored as inputs.

## Policy change discipline

A policy change requires tests for every affected truth-table row, negative tests for bypasses, a version increment in emitted bundles, and an update to this document. Do not weaken a rule simply to make the demo pass.

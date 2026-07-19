# Evidence and decision model

## Purpose

The evidence model makes every conclusion traceable without pretending that different kinds of proof are interchangeable. A criterion may need repository evidence, external authority, or both; EvidenceGate records those assessments separately before applying deterministic policy.

## Core entities

| Entity                 | Meaning                                                                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Task specification     | Versioned request containing repository scope, Git refs, risk, source mode, and acceptance criteria                                    |
| Acceptance criterion   | User-authored requirement with stable ID, category, required flag, intended evidence domain, and optional research constraints         |
| Normalized claim       | A bounded, testable statement derived from one criterion; preserves the originating criterion ID and original text                     |
| Internal evidence item | An observed repository fact: diff/file excerpt, test/build/lint/type-check result, runtime probe, dependency/config/migration/doc fact |
| External source record | A policy-evaluated record derived from an actual returned research source; defined in [SOURCE_MODEL.md](SOURCE_MODEL.md)               |
| Claim assessment       | A status plus referenced evidence/source IDs, contradictions, missing evidence, limitations, and explanation                           |
| Finding                | Actionable issue with stable ID, severity, criterion links, and supporting evidence/source links                                       |
| Gate decision          | Deterministic result, reason codes, failed/warning criteria, policy version, and exit code                                             |
| Evidence bundle        | Canonical versioned container for the task, snapshot, evidence, sources, assessments, runs, findings, gate, and integrity hash         |

IDs must be unique within a bundle. Every cross-reference is validated before adjudication, gating, report generation, and bundle verification.

## Claim classification

- **internal:** established through the repository or execution, such as “unauthorized users receive HTTP 401.”
- **external:** established through an outside authority, such as “the vendor currently supports this runtime.”
- **hybrid:** requires an external requirement and internal implementation, such as “the code uses the vendor's current recommended authentication flow.”
- **subjective:** needs a measurable rubric before verification, such as “the UX is excellent.”
- **unsupported_scope:** too broad for responsible verification, such as “the software has no bugs” or “complies with every law.”

The task schema may use `auto` before classification. The normalized record must contain the resolved class, rationale, classifier provenance, and any user override; `auto` is not a final evidence domain.

## Internal evidence contract

An internal evidence item should record at least:

- stable `evidenceId`, `kind`, collection time, and collector version;
- repository/ref/path/command provenance as applicable;
- bounded summary and structured details, not an unbounded log dump;
- content hash when the observed artifact is serialized;
- affected criterion IDs and any limitations;
- outcome metadata for execution: exact configured command identifier, exit code, signal/timeout, duration, required flag, and redaction/truncation markers.

The distinction between **observed** and **interpreted** data is mandatory. “Test command exited 0” is an observation. “This test proves criterion AC-11” is an assessment referencing that observation.

## Assessment statuses

### Internal

| Status               | Meaning                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| `verified`           | Sufficient relevant implementation/execution evidence directly supports the full claim |
| `partially_verified` | Evidence supports only part of the claim or an important execution layer is missing    |
| `unsupported`        | No sufficient relevant internal evidence exists                                        |
| `contradicted`       | Repository or execution evidence conflicts with the claim                              |
| `not_applicable`     | The claim does not require internal evidence                                           |
| `analysis_error`     | Internal evidence could not be reliably parsed or assessed                             |

### External

| Status                 | Meaning                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `supported`            | Policy-valid, sufficiently current authority supports the full external claim |
| `partially_supported`  | Sources support only part of the claim or have material limitations           |
| `not_supported`        | Valid research found no adequate support                                      |
| `contradicted`         | Authoritative evidence conflicts with the claim                               |
| `conflicting_sources`  | Credible sources disagree and policy cannot resolve the conflict safely       |
| `insufficient_sources` | Source count/type/freshness requirements are not met                          |
| `source_error`         | Required research or citation/source integrity failed operationally           |
| `not_applicable`       | The claim does not require external evidence                                  |

### Combined

| Status               | Meaning                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `verified`           | Every required domain is fully satisfied                                                                       |
| `partially_verified` | Some valid support exists, but a non-critical portion remains incomplete; never passes a required hybrid claim |
| `unsupported`        | Required support is missing                                                                                    |
| `contradicted`       | At least one authoritative required domain definitively conflicts with the claim                               |
| `manual_review`      | Evidence conflict, high-stakes ambiguity, or policy-defined human judgment is required                         |
| `analysis_error`     | A required assessment could not be constructed reliably; external detail may separately be `source_error`      |

## Combination rules

For a required hybrid criterion, the central truth table is:

| Internal                             | External                                 | Combined                                                                                    |
| ------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `verified`                           | `supported`                              | `verified`                                                                                  |
| `verified`                           | `partially_supported`                    | `partially_verified` or `manual_review`, never pass                                         |
| `verified`                           | `not_supported` / `insufficient_sources` | `unsupported`                                                                               |
| `verified`                           | `conflicting_sources`                    | `manual_review`                                                                             |
| `verified`                           | `contradicted`                           | `contradicted`                                                                              |
| `unsupported` / `partially_verified` | `supported`                              | `unsupported` / `partially_verified`, never pass                                            |
| `contradicted`                       | any non-error result                     | `contradicted`                                                                              |
| any                                  | `source_error`                           | cannot verify; overall gate records `Source Error` when no definitive failure supersedes it |
| `analysis_error`                     | any                                      | `analysis_error`                                                                            |

For an internal-only claim, external status is `not_applicable`; for an external-only claim, internal status is `not_applicable`. Optional criteria can produce warnings but cannot mask a failing required criterion.

## Deterministic gate

GPT-5.6 supplies schema-valid assessments and explanations; it never returns the authoritative gate result. The gate engine applies a versioned rule set to validated inputs and emits reason codes.

Definitive failure conditions include:

- unsupported or contradicted required internal criteria;
- contradicted required external criteria or all sources violating policy;
- a required hybrid criterion without both full domain results;
- a required configured command failure;
- a critical finding;
- invalid citation/source binding when the affected external evidence is required;
- a current required claim supported only by stale evidence, unless a recorded policy override explicitly permits it.

Manual review conditions include unresolved authoritative conflicts, jurisdiction ambiguity, high-stakes claims, unclear version/date scope, and partial authority where policy requires a human. Operational research/integrity failure is distinguished as `Source Error`; malformed core analysis is `Analysis Error`.

If multiple conditions coexist, a definitive required-criterion failure remains `Fail` and the report also exposes source/analysis errors. Otherwise the policy emits the most specific blocking state, then `Pass With Warnings` or `Pass`. This precedence must be encoded and tested, not inferred from prose.

## Bundle contract

Schema version 1 contains:

- bundle identity, generation time, tool version, and task;
- repository snapshot and all internal evidence;
- external source registry and research runs;
- internal, external, and combined claim assessments;
- model-run metadata (model ID/alias, purpose, timestamps, schema version, result status; never credentials);
- findings and deterministic gate decision;
- source-policy and gate-policy versions;
- `bundleHash`.

### Canonical integrity rules

1. Validate the entire object and referential integrity before hashing.
2. Serialize as UTF-8 with recursively sorted object keys and documented array ordering.
3. Omit or set `bundleHash` to the defined neutral value during hash computation.
4. Exclude volatile presentation-only state; retain decision-relevant timestamps and policy/model metadata.
5. Hash with the selected versioned algorithm and record that algorithm with the bundle format.
6. Verification repeats schema, cross-reference, canonicalization, and hash checks before showing a trusted result.

A matching hash proves bundle integrity relative to the captured bytes and algorithm; it does not prove that the original observations or sources were correct.

## Evidence graph invariants

- Criteria link to normalized claims; claims link to assessments; assessments link only to known evidence/source IDs.
- Contradicting evidence is preserved rather than removed when supporting evidence exists.
- A test passing is not sufficient unless the test is relevant to the criterion.
- Source authority is represented through transparent attributes and rules, not one opaque quality score.
- Missing evidence is explicit and actionable.
- Every report view is generated from the same validated bundle used by the gate.

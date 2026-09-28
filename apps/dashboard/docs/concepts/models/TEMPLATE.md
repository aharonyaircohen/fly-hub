# Model name

Status: Draft | Reviewed | Canonical  
Last verified: YYYY-MM-DD  
Owners: Product | Domain  
Implementation: `model-implementation.md`  
Load when: Any task needs this model's meaning, fields, ownership, or relationships

## Meaning

One short explanation of the model and why no existing model owns this
responsibility.

## Owns

- Exact responsibility.

## Does not own

- Responsibility owned elsewhere.

## Boundary test

1. Question confirming data belongs here.
2. Question rejecting data owned elsewhere.

## Data kinds

| Part         | Kind              | Mutable?      | Identity?             | Lifecycle? |
| ------------ | ----------------- | ------------- | --------------------- | ---------- |
| Definition   | Authored contract | No            | Yes                   | Yes        |
| State        | Runtime State     | Yes           | References Definition | No         |
| Event/output | History           | Append-only   | Yes                   | No         |
| Value        | Embedded contract | Through owner | No                    | No         |

## Contract

### Definition

| Field | Type   | Required | Meaning         | Validation | Excludes             |
| ----- | ------ | -------- | --------------- | ---------- | -------------------- |
| `id`  | string | Yes      | Stable identity | Exact rule | Storage/runtime data |

### State

| Field          | Type   | Required | Meaning            | Validation          |
| -------------- | ------ | -------- | ------------------ | ------------------- |
| `definitionId` | string | Yes      | Definition tracked | Existing Definition |

### History

Describe events, decisions, Facts, Evidence, Artifacts, and retention.

### Values

Describe embedded contracts with no independent identity or Lifecycle.

## Invariants

- `MOD-01` — Model MUST ...
- `MOD-02` — Model MUST NOT ...

Link implementation enforcement to
`model-implementation.md#enforcement-status`.

## Lifecycle

```text
draft -> active -> paused -> retired -> archived
```

| State | Meaning | Enter when | Allowed exits |
| ----- | ------- | ---------- | ------------- |
| Draft | Meaning | Conditions | Transitions   |

Define semantic creation, change, retirement, archive, restore, deletion, and
reference-protection rules. Put current mechanics in the implementation guide.

## Relationships

| Model         | Direction         | Cardinality | Type                 | Rule          |
| ------------- | ----------------- | ----------- | -------------------- | ------------- |
| Related model | Incoming/outgoing | One/many    | Ownership/dependency | Exact meaning |

Define revision pinning, missing references, cycles, shared ownership, and
deletion impact.

## Human and AI authority

- Human MAY ...
- AI manager MAY ...
- AI manager MUST NOT ...
- Human approval IS REQUIRED for ...

## Approved target

List approved semantic rules only. Put proposals and migration work in the
implementation guide.

## Examples

Include:

- smallest valid example;
- full valid example when useful;
- responsibility violation;
- invalid relationship;
- Definition/State mix;
- State/History mix.

Name the violated rule ID.

## Decisions

| ID        | Date       | Decision | Why    | Evidence | Approved by |
| --------- | ---------- | -------- | ------ | -------- | ----------- |
| `MOD-D01` | YYYY-MM-DD | Decision | Reason | Source   | Owner       |

## Open model decisions

List only decision IDs and short names. Keep evidence, options, impact, and
owners in the implementation guide.

Blocking questions stop dependent implementation.

## Sources

- Canonical concepts:
- Domain contract:
- Implementation evidence: `model-implementation.md`

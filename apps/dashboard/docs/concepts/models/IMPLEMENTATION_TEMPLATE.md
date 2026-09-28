# Model name implementation guide

Status: Unverified | Partially verified | Verified current  
Last verified: YYYY-MM-DD  
Model contract: `model.md`  
Load when: Editing, debugging, testing, running, or migrating this model

## Reading map

| Task           | Required sections                               |
| -------------- | ----------------------------------------------- |
| Find ownership | Authority and storage, Current implementation   |
| Change runtime | Runtime, API and events, Agent rules            |
| Migrate data   | Gaps, Open questions, Agent rules, Verification |

Read the model contract first.

## Projection behavior

Document UI/edit projections, derived fields, lossy mappings, and which shapes
MUST NOT be persisted.

## Enforcement status

| Rule     | Write enforcement      | Runtime enforcement    | Database           | Doctor        |
| -------- | ---------------------- | ---------------------- | ------------------ | ------------- |
| `MOD-01` | File/symbol or missing | File/symbol or missing | Constraint/missing | Check/missing |

## Authority and storage

| Data          | Authority | Current storage | Scope | Readers | Writers |
| ------------- | --------- | --------------- | ----- | ------- | ------- |
| Definition    | Authority | Location        | Scope | Symbols | Symbols |
| State         | Authority | Location        | Scope | Symbols | Symbols |
| History       | Authority | Location        | Scope | Symbols | Symbols |
| Compatibility | None      | Location        | Scope | Symbols | Symbols |

Name every cache, projection, graph, manifest, index, fallback, and dual-write.

## Runtime

```text
author -> validate -> persist -> activate -> dispatch -> state -> history
```

Document exact services, auth, policy, idempotency, concurrency, retries,
failure recovery, and operator-visible results.

## API and events

| Boundary | Method/event | Purpose | Reads | Writes | Authorization |
| -------- | ------------ | ------- | ----- | ------ | ------------- |
| API/job  | Method       | Purpose | Data  | Data   | Rule          |

## Current implementation

### Types and validators

- `file`: `symbol`

### Persistence

- Definition:
- State:
- History:
- Compatibility:

### Readers

- Exact file and symbol.

### Writers

- Exact route, service, job, or tool.

### Mounted/real path

```text
user/trigger -> mounted surface -> service -> persistence -> visible result
```

## Proposed implementation changes

List unapproved proposals. They MUST NOT be treated as target rules.

## Gaps

| ID        | Area | Current | Target | Risk   | Migration | Completion proof |
| --------- | ---- | ------- | ------ | ------ | --------- | ---------------- |
| `MOD-G01` | Area | Fact    | Rule   | Effect | Work      | Exact check      |

A gap remains open while any fallback, inference, dual-write, compatibility
reader, or compatibility writer remains.

## Open questions

| ID        | Question | Impact | Options | Owner | Blocks? |
| --------- | -------- | ------ | ------- | ----- | ------- |
| `MOD-Q01` | Question | Why    | Options | Owner | Yes/no  |

## Agent rules

### Required context

- Model index.
- Model contract.
- Relevant sections of this guide and related models.
- Exact sources.
- Repository behavior and testing policy.

### Allowed

- Change preserving the approved model.

### Requires model decision

- Responsibility, authority, Lifecycle, relationship, or storage change.
- Definition/State/History merge.
- New fallback, dual-write, or compatibility authority.

### Forbidden

- Inference where target requires explicit data.
- Copied shared definitions.
- Runtime State in GitHub.
- Derived data as authority.
- Silent second authority.
- False migration completion.

### Implementation order

1. Trace the real path.
2. Add contract/invariant tests.
3. Change the owning service.
4. Update adapters and migration.
5. Update every reader/writer.
6. Remove compatibility paths.
7. Verify persistence, runtime, and UI.
8. Update this guide from final evidence.

### Required proof

| Boundary    | Proof                  | Pass condition           |
| ----------- | ---------------------- | ------------------------ |
| Contract    | Unit/architecture      | Rules enforced           |
| Persistence | Integration            | Correct authority        |
| Runtime     | Real path              | State/History correct    |
| Dashboard   | Canonical browser path | UI and persistence agree |
| Migration   | Compatibility audit    | Old paths absent         |

### Stop when

- Blocking question applies.
- Evidence contradicts approved model.
- Ownership/deletion is unclear.
- Change creates a second authority.
- Required migration or real-path proof cannot complete.
- Requested change expands responsibility.

## Verification

- [ ] Types and validators inspected.
- [ ] Readers and writers identified.
- [ ] Storage checked.
- [ ] One real path traced.
- [ ] Data kinds remain separated.
- [ ] Current and target separated.
- [ ] Gaps have exact proof.
- [ ] Required owners reviewed.

## Sources

- Domain:
- Persistence:
- API:
- Runtime:
- Dashboard:
- Tests:
- Existing docs:

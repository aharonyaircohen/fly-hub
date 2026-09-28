# Historical implementation model

Status: **Retired from the public Dashboard model**

The old Dashboard exposed separate Implementation folders, routes, bindings,
and UI. Those surfaces were removed.

Current public behavior is a simple Capability folder:

```text
capabilities/<slug>/
├── instructions.md
├── skills/
└── tools/
```

Kody Engine still uses internal implementation profiles to select providers,
models, scripts, lifecycle behavior, and tools. Those profiles are technical
runtime assets behind the generic runner, not a user-managed Agency model.

Do not add compatibility readers or restore the old UI. Existing stored legacy
folders should be explicitly migrated or removed.

# Capability

Status: **Current Dashboard contract**

A Capability is one reusable method with one input and one output.

```text
capabilities/<slug>/
├── instructions.md
├── skills/
└── tools/
```

- `instructions.md` is required and explains the work.
- `skills/` contains optional reusable instruction files.
- `tools/` contains optional executable or tool configuration files.

A Capability does not select an Agent, model, schedule, permission mode, Loop,
or Workflow. Direct runs use Kody. A Workflow selects another Agent when needed.

The public Capability is the folder. Engine implementation profiles are
technical runtime assets, not another public Agency model.

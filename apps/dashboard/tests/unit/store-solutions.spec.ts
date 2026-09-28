import { describe, expect, it } from "vitest";

import {
  resolveStoreSolutionTree,
  type StoreSolutionCatalog,
} from "@dashboard/lib/store-solutions";

const catalog: StoreSolutionCatalog = {
  agents: new Set(["kody"]),
  capabilities: new Set(["prepare", "deploy"]),
  pipelines: new Map(),
  workflows: new Map([
    [
      "web-release",
      {
        id: "web-release",
        name: "Web Release",
        agent: "kody",
        capabilities: ["prepare", "deploy"],
      },
    ],
  ]),
  loops: new Map([
    [
      "daily-web-release-loop",
      {
        id: "daily-web-release-loop",
        target: { kind: "workflow", id: "web-release" },
      },
    ],
  ]),
  triggers: new Map([
    [
      "release-on-ci-success",
      {
        id: "release-on-ci-success",
        name: "Release on CI success",
        target: { kind: "workflow", id: "web-release" },
      },
    ],
  ]),
};

const manifest = {
  schemaVersion: 1 as const,
  id: "web-release",
  name: "Web Release",
  description: "Safely release the website.",
  entrypoints: [{ kind: "loop" as const, id: "daily-web-release-loop" }],
};

describe("Store Solution dependency trees", () => {
  it("derives Loop, Workflow, Agent, and Capability dependencies", () => {
    const resolved = resolveStoreSolutionTree(manifest, catalog, {
      agents: new Set(),
      capabilities: new Set(),
      workflows: new Set(),
      loops: new Set(),
      pipelines: new Set(),
      triggers: new Set(),
    });

    expect(resolved.status).toBe("available");
    expect(resolved.tree).toEqual([
      {
        kind: "loop",
        slug: "daily-web-release-loop",
        title: "Daily Web Release Loop",
        installed: false,
        children: [
          {
            kind: "workflow",
            slug: "web-release",
            title: "Web Release",
            installed: false,
            children: [
              {
                kind: "agent",
                slug: "kody",
                title: "Kody",
                installed: false,
                children: [],
              },
              {
                kind: "capability",
                slug: "prepare",
                title: "Prepare",
                installed: false,
                children: [],
              },
              {
                kind: "capability",
                slug: "deploy",
                title: "Deploy",
                installed: false,
                children: [],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("reports partially installed and fully installed Solutions", () => {
    const partial = resolveStoreSolutionTree(manifest, catalog, {
      agents: new Set(["kody"]),
      capabilities: new Set(["prepare"]),
      workflows: new Set(["web-release"]),
      loops: new Set(),
      pipelines: new Set(),
      triggers: new Set(),
    });
    expect(partial.status).toBe("partial");

    const installed = resolveStoreSolutionTree(manifest, catalog, {
      agents: new Set(["kody"]),
      capabilities: new Set(["prepare", "deploy"]),
      workflows: new Set(["web-release"]),
      loops: new Set(["daily-web-release-loop"]),
      pipelines: new Set(),
      triggers: new Set(),
    });
    expect(installed.status).toBe("installed");
  });

  it("rejects a missing entry point before installation", () => {
    expect(() =>
      resolveStoreSolutionTree(
        {
          ...manifest,
          entrypoints: [{ kind: "workflow", id: "missing" }],
        },
        catalog,
        {
          agents: new Set(),
          capabilities: new Set(),
          workflows: new Set(),
          loops: new Set(),
          pipelines: new Set(),
          triggers: new Set(),
        },
      ),
    ).toThrow(
      'Store Solution "web-release" references missing Workflow "missing".',
    );
  });

  it("accepts Engine built-in capabilities without Store folders", () => {
    const builtInCatalog: StoreSolutionCatalog = {
      ...catalog,
      workflows: new Map([
        [
          "chore",
          {
            id: "chore",
            name: "Chore",
            agent: "kody",
            capabilities: ["run"],
          },
        ],
      ]),
    };

    expect(() =>
      resolveStoreSolutionTree(
        {
          ...manifest,
          id: "chore",
          entrypoints: [{ kind: "workflow", id: "chore" }],
        },
        builtInCatalog,
        {
          agents: new Set(),
          capabilities: new Set(),
          workflows: new Set(),
          loops: new Set(),
          pipelines: new Set(),
          triggers: new Set(),
        },
      ),
    ).not.toThrow();
  });

  it("derives Trigger dependencies and installed state", () => {
    const triggerManifest = {
      ...manifest,
      entrypoints: [{ kind: "trigger" as const, id: "release-on-ci-success" }],
    };

    const available = resolveStoreSolutionTree(triggerManifest, catalog, {
      agents: new Set(),
      capabilities: new Set(),
      workflows: new Set(),
      loops: new Set(),
      pipelines: new Set(),
      triggers: new Set(),
    });
    expect(available.tree[0]).toMatchObject({
      kind: "trigger",
      slug: "release-on-ci-success",
      installed: false,
      children: [{ kind: "workflow", slug: "web-release" }],
    });

    const installed = resolveStoreSolutionTree(triggerManifest, catalog, {
      agents: new Set(["kody"]),
      capabilities: new Set(["prepare", "deploy"]),
      workflows: new Set(["web-release"]),
      loops: new Set(),
      pipelines: new Set(),
      triggers: new Set(["release-on-ci-success"]),
    });
    expect(installed.status).toBe("installed");
  });
});

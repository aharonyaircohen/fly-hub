import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

const TENANT = "acme/app";
const CREATED_AT = "2026-07-18T00:00:00.000Z";

describe("versioned agency definitions", () => {
  it("stores goals, technical Implementation packages, and reusable assets", async () => {
    const t = setup();
    for (const [kind, slug, files] of [
      [
        "goal",
        "quality",
        { "goal.md": "# Quality\n", "goal.json": "{\"active\":true}\n" },
      ],
      [
        "implementation",
        "safe-deployer",
        { "runtime.json": "{}\n", "scripts/deploy.sh": "#!/bin/sh\n" },
      ],
      [
        "asset",
        "skill-release-review",
        { "skills/release-review/SKILL.md": "# Release review\n" },
      ],
    ] as const) {
      await t.mutation(api.definitions.publish, {
        tenantId: TENANT,
        kind,
        slug,
        version: `sha256:${slug}`,
        bundle: { schemaVersion: 1, files },
        source: "store",
        createdAt: CREATED_AT,
      });
      expect(
        await t.query(api.definitions.getCurrent, {
          tenantId: TENANT,
          kind,
          slug,
        }),
      ).toMatchObject({ kind, slug, bundle: { files } });
    }
  });

  it("keeps immutable history while advancing the current definition", async () => {
    const t = setup();

    await t.mutation(api.definitions.publish, {
      tenantId: TENANT,
      kind: "capability",
      slug: "ci-health",
      version: "sha256:v1",
      bundle: { profile: { action: "ci-health" }, body: "first" },
      source: "store",
      createdAt: CREATED_AT,
    });
    await t.mutation(api.definitions.publish, {
      tenantId: TENANT,
      kind: "capability",
      slug: "ci-health",
      version: "sha256:v2",
      bundle: { profile: { action: "ci-health" }, body: "second" },
      createdAt: "2026-07-18T00:01:00.000Z",
    });

    const current = await t.query(api.definitions.getCurrent, {
      tenantId: TENANT,
      kind: "capability",
      slug: "ci-health",
    });
    const first = await t.query(api.definitions.getVersion, {
      tenantId: TENANT,
      kind: "capability",
      slug: "ci-health",
      version: "sha256:v1",
    });

    expect(current).toMatchObject({
      version: "sha256:v2",
      bundle: { body: "second" },
    });
    expect(first).toMatchObject({
      version: "sha256:v1",
      source: "store",
      bundle: { body: "first" },
    });
    expect(
      await t.query(api.definitions.listVersions, {
        tenantId: TENANT,
        kind: "capability",
        slug: "ci-health",
      }),
    ).toHaveLength(2);
  });

  it("rejects changing the content of an existing immutable version", async () => {
    const t = setup();
    const input = {
      tenantId: TENANT,
      kind: "agent" as const,
      slug: "reviewer",
      version: "sha256:stable",
      bundle: { body: "original" },
      createdAt: CREATED_AT,
    };
    await t.mutation(api.definitions.publish, input);

    await expect(
      t.mutation(api.definitions.publish, {
        ...input,
        bundle: { body: "changed" },
      }),
    ).rejects.toThrow("definition version is immutable");
  });

  it("retires the current definition without deleting its version history", async () => {
    const t = setup();
    await t.mutation(api.definitions.publish, {
      tenantId: TENANT,
      kind: "agent",
      slug: "reviewer",
      version: "sha256:v1",
      bundle: { body: "Review carefully" },
      createdAt: CREATED_AT,
    });

    await t.mutation(api.definitions.retire, {
      tenantId: TENANT,
      kind: "agent",
      slug: "reviewer",
    });

    expect(
      await t.query(api.definitions.getCurrent, {
        tenantId: TENANT,
        kind: "agent",
        slug: "reviewer",
      }),
    ).toBeNull();
    expect(
      await t.query(api.definitions.getVersion, {
        tenantId: TENANT,
        kind: "agent",
        slug: "reviewer",
        version: "sha256:v1",
      }),
    ).toMatchObject({ bundle: { body: "Review carefully" } });
  });
});

import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";

import { listStoreCatalogSlugs } from "@dashboard/lib/store-catalog-index";

describe("Store catalog index", () => {
  it("lists every Store kind with one config read and one directory read each", async () => {
    const getContent = vi.fn(async ({ path }: { path: string }) => {
      if (path === "kody-store.json") {
        return {
          data: {
            content: Buffer.from(
              JSON.stringify({
                assetRoots: {
                  capabilities: "capabilities",
                  agent: "agents",
                  commands: "commands",
                  workflows: "workflows",
                  pipelines: "pipelines",
                  loops: "loops",
                  triggers: "triggers",
                  solutions: "solutions",
                  strategies: "strategies",
                },
              }),
            ).toString("base64"),
          },
        };
      }
      const markdown = path === "agents" || path === "commands";
      return {
        data: [
          {
            name: markdown ? "sample.md" : "sample",
            type: markdown ? "file" : "dir",
          },
        ],
      };
    });
    const octokit = {
      repos: { getContent },
    } as unknown as Octokit;

    await expect(listStoreCatalogSlugs(octokit)).resolves.toEqual({
      capabilities: ["sample"],
      agents: ["sample"],
      commands: ["sample"],
      workflows: ["sample"],
      pipelines: ["sample"],
      loops: ["sample"],
      triggers: ["sample"],
      solutions: ["sample"],
      strategies: ["sample"],
    });
    expect(getContent).toHaveBeenCalledTimes(10);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPreviewBuilderStatus,
  spawnAppBuilder,
} from "../../src/previews/builder-client";
import { clearAppBuilderCredentials } from "../../builder/src/app-builder-cleanup";

const app = "flyhub-app-test-123456789abc";
const host = "test-builder";
afterEach(() => vi.unstubAllGlobals());

describe("deployment worker isolation", () => {
  it("preserves active and completed save/restore workers and unknown machines", async () => {
    const workers = [
      {
        id: "save",
        state: "started",
        config: { env: { APP_IMAGE_JOB: "save" } },
      },
      {
        id: "restore",
        state: "started",
        config: { metadata: { flyhub_image_action: "create" } },
      },
      {
        id: "finished-save",
        state: "stopped",
        config: { env: {}, metadata: { flyhub_image_action: "save" } },
      },
      { id: "unknown", state: "started", config: { env: {} } },
      {
        id: "old-build",
        state: "stopped",
        config: {
          metadata: { flyhub_build_app: app, flyhub_build_status: "completed" },
        },
      },
    ];
    const fetch = vi.fn(async (_url, init) =>
      init?.method === "GET"
        ? Response.json(workers)
        : init?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : Response.json({ id: "new-build" }),
    );
    vi.stubGlobal("fetch", fetch);
    await spawnAppBuilder({
      repo: "acme/site",
      ref: "a".repeat(40),
      appName: app,
      imageTag: "test",
      buildPlan: { kind: "static", rootDirectory: ".", port: 8080 },
      exposure: "private",
      tokenHashes: [],
      runtimeEnv: {},
      runtimeSecrets: {},
      flyToken: "fake",
      flyOrgSlug: "personal",
      flyRegion: "iad",
      builderHostApp: host,
    });
    expect(
      fetch.mock.calls
        .filter(([, init]) => init?.method === "DELETE")
        .map(([url]) => url),
    ).toEqual([
      `https://api.machines.dev/v1/apps/${host}/machines/old-build?force=true`,
    ]);
  });

  it("keeps completed build status discoverable after credentials are removed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          {
            id: "finished",
            state: "stopped",
            created_at: new Date().toISOString(),
            config: {
              env: {},
              metadata: {
                flyhub_build_app: app,
                flyhub_build_ref: "a".repeat(40),
                flyhub_build_status: "completed",
              },
            },
          },
        ]),
      ),
    );
    expect(await getPreviewBuilderStatus(app, "fake", host)).toMatchObject({
      state: "completed",
      machineId: "finished",
    });
  });
});

describe("build worker credential cleanup", () => {
  it.each(["completed", "failed"] as const)(
    "erases all credentials and retains %s diagnostics",
    async (status) => {
      const fetch = vi.fn(async (url, init) =>
        init?.method === "POST"
          ? Response.json({})
          : String(url).endsWith("/metadata")
            ? Response.json({ flyhub_last_error: "retained log" })
            : Response.json({
                config: {
                  image: "builder-image",
                  env: {
                    APP_NAME: app,
                    REF: "a".repeat(40),
                    FLY_API_TOKEN: "secret-fly",
                    GITHUB_TOKEN: "secret-github",
                    APP_RUNTIME_SECRETS_JSON: '{"MODEL_KEY":"secret-model"}',
                    APP_CALLBACK_JSON: '{"token":"secret-callback"}',
                  },
                },
              }),
      );
      vi.stubGlobal("fetch", fetch);
      await clearAppBuilderCredentials({
        app: host,
        machine: "worker",
        token: "secret-fly",
        status,
        metadata: {
          flyhub_cleanup_status: "completed",
          flyhub_cleanup_detail:
            "Cleanup completed. New app resources removed.",
          flyhub_last_error:
            "Latest failure detail retained despite an older Fly metadata response",
        },
      });
      const update = fetch.mock.calls.find(
        ([, init]) => init?.method === "POST",
      )!;
      const body = JSON.parse(update[1]!.body as string);
      expect(body).toMatchObject({
        skip_launch: true,
        config: {
          env: {},
          metadata: {
            flyhub_build_app: app,
            flyhub_build_status: status,
            flyhub_last_error:
              "Latest failure detail retained despite an older Fly metadata response",
            flyhub_cleanup_status: "completed",
            flyhub_cleanup_detail:
              "Cleanup completed. New app resources removed.",
          },
        },
      });
      for (const secret of [
        "secret-fly",
        "secret-github",
        "secret-model",
        "secret-callback",
      ])
        expect(JSON.stringify(body)).not.toContain(secret);
    },
  );
});

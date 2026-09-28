import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@kody-ade/base/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../src/dashboard/lib/github-client", () => ({
  invalidateIssueCache: vi.fn(),
  invalidatePRCache: vi.fn(),
}));

vi.mock("../../src/dashboard/lib/capabilities", () => ({
  isValidSlug: vi.fn((slug: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)),
}));

const capabilities = vi.hoisted(() => ({ readCapabilityFile: vi.fn() }));
vi.mock("@kody-ade/agency/capabilities", () => ({
  readCapabilityFile: capabilities.readCapabilityFile,
}));

const { createKodyTools } =
  await import("../../app/api/kody/chat/tools/kody-tools");

function createCtx({ isPr = false }: { isPr?: boolean } = {}) {
  const createComment = vi.fn().mockResolvedValue({});
  const get = vi.fn().mockResolvedValue({
    data: {
      html_url: "https://github.test/repo/issues/123",
      ...(isPr ? { pull_request: {} } : {}),
    },
  });
  const ctx = {
    owner: "test-owner",
    repo: "test-repo",
    octokit: {
      rest: {
        issues: {
          get,
          createComment,
        },
      },
    },
  } as unknown as Parameters<typeof createKodyTools>[0];
  return { createComment, ctx };
}

function executeOptions<T extends (...args: never[]) => unknown>(
  _execute: T | undefined,
): Parameters<T>[1] {
  return {} as Parameters<T>[1];
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("kody dispatch tools use capabilities", () => {
  it("uses a bare @kody comment for the configured default issue capability", async () => {
    const { ctx, createComment } = createCtx();
    capabilities.readCapabilityFile.mockResolvedValue(null);

    const tools = createKodyTools(ctx);
    const result = await tools.kody_run_issue.execute?.(
      {
        issueNumber: 123,
        notes: "ship this",
      },
      executeOptions(tools.kody_run_issue.execute),
    );

    expect(result).toMatchObject({ command: "@kody", triggered: true });
    expect(capabilities.readCapabilityFile).not.toHaveBeenCalled();
    expect(createComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 123,
      body: "@kody\n\nship this",
    });
  });

  it("keeps an explicitly requested built-in run action explicit", async () => {
    const { ctx, createComment } = createCtx();

    const tools = createKodyTools(ctx);
    const result = await tools.kody_run_issue.execute?.(
      { issueNumber: 123, capability: "run" },
      executeOptions(tools.kody_run_issue.execute),
    );

    expect(result).toMatchObject({ command: "@kody run", triggered: true });
    expect(createComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 123,
      body: "@kody run",
    });
  });

  it("refuses to run an issue command when the capability folder is missing", async () => {
    const { ctx, createComment } = createCtx();
    capabilities.readCapabilityFile.mockResolvedValue(null);

    const tools = createKodyTools(ctx);
    const result = await tools.kody_run_issue.execute?.(
      {
        issueNumber: 123,
        capability: "feature",
      },
      executeOptions(tools.kody_run_issue.execute),
    );

    expect(result).toMatchObject({
      error: 'Refusing to dispatch: capability "feature" was not found.',
    });
    expect(createComment).not.toHaveBeenCalled();
  });

  it("posts the capability action for issue dispatch", async () => {
    const { ctx, createComment } = createCtx();
    capabilities.readCapabilityFile.mockResolvedValue({
      slug: "feature",
      instructions: "Ship the feature",
      skills: [],
      capabilityTools: [],
    });

    const tools = createKodyTools(ctx);
    const result = await tools.kody_run_issue.execute?.(
      {
        issueNumber: 123,
        capability: "feature",
        notes: "ship this",
      },
      executeOptions(tools.kody_run_issue.execute),
    );

    expect(result).toMatchObject({
      command: "@kody feature",
      triggered: true,
      url: "/repo/test-owner/test-repo/123",
    });
    expect(capabilities.readCapabilityFile).toHaveBeenCalledWith("feature");
    expect(createComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 123,
      body: "@kody feature\n\nship this",
    });
  });

  it("refuses PR dispatch when the command has no capability", async () => {
    const { ctx, createComment } = createCtx({ isPr: true });
    capabilities.readCapabilityFile.mockResolvedValue(null);

    const tools = createKodyTools(ctx);
    const result = await tools.kody_fix_pr.execute?.(
      { prNumber: 123 },
      executeOptions(tools.kody_fix_pr.execute),
    );

    expect(result).toMatchObject({
      error: 'Refusing to dispatch: capability "fix" was not found.',
    });
    expect(createComment).not.toHaveBeenCalled();
  });
});

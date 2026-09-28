import { describe, expect, it, vi } from "vitest";

import {
  bearerToken,
  verifyGitHubWorkflowIdentity,
} from "@dashboard/lib/backend/github-actions-identity";

describe("GitHub Actions workflow identity", () => {
  it("accepts the repository's Kody workflow", async () => {
    const verify = vi.fn().mockResolvedValue({
      payload: {
        repository: "A-Guy-educ/A-Guy-Web",
        workflow_ref:
          "A-Guy-educ/A-Guy-Web/.github/workflows/kody.yml@refs/heads/dev",
        actor: "aguyaharonyair",
        run_id: "123",
      },
    });

    await expect(
      verifyGitHubWorkflowIdentity("signed", verify as never),
    ).resolves.toEqual({
      repository: "A-Guy-educ/A-Guy-Web",
      workflowRef:
        "A-Guy-educ/A-Guy-Web/.github/workflows/kody.yml@refs/heads/dev",
      actor: "aguyaharonyair",
      runId: "123",
    });
    expect(verify).toHaveBeenCalledWith(
      "signed",
      expect.anything(),
      expect.objectContaining({
        issuer: "https://token.actions.githubusercontent.com",
        audience: "kody-api",
      }),
    );
  });

  it("rejects a token issued for a different workflow", async () => {
    const verify = vi.fn().mockResolvedValue({
      payload: {
        repository: "A-Guy-educ/A-Guy-Web",
        workflow_ref:
          "A-Guy-educ/A-Guy-Web/.github/workflows/ci.yml@refs/heads/dev",
      },
    });

    await expect(
      verifyGitHubWorkflowIdentity("signed", verify as never),
    ).rejects.toThrow("not issued for the Kody workflow");
  });

  it("normalizes a numeric GitHub workflow run id", async () => {
    const verify = vi.fn().mockResolvedValue({
      payload: {
        repository: "A-Guy-educ/A-Guy-Web",
        workflow_ref:
          "A-Guy-educ/A-Guy-Web/.github/workflows/kody.yml@refs/heads/dev",
        run_id: 33720188688,
      },
    });

    await expect(
      verifyGitHubWorkflowIdentity("signed", verify as never),
    ).resolves.toMatchObject({ runId: "33720188688" });
  });

  it("reads only a bearer authorization header", () => {
    expect(
      bearerToken(
        new Request("https://kody.test", {
          headers: { authorization: "Bearer proof" },
        }),
      ),
    ).toBe("proof");
    expect(
      bearerToken(
        new Request("https://kody.test", {
          headers: { authorization: "Basic proof" },
        }),
      ),
    ).toBeNull();
  });
});

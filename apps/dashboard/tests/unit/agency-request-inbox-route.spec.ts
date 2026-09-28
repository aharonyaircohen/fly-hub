import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const baseRoute = vi.hoisted(() => ({
  PATCH: vi.fn(async () =>
    NextResponse.json({ todo: { title: "Build Healthy CI" } }),
  ),
  GET: vi.fn(),
  DELETE: vi.fn(),
}));
vi.mock("@kody-ade/workspace/routes/todos-slug", () => baseRoute);

const auth = vi.hoisted(() => ({
  getRequestAuth: vi.fn(() => ({
    owner: "acme",
    repo: "widgets",
    token: "token",
  })),
  getUserOctokit: vi.fn(async () => ({ rest: {} })),
}));
vi.mock("@kody-ade/base/auth", () => auth);

const inbox = vi.hoisted(() => ({
  appendInboxEntries: vi.fn(async () => ({ added: 1 })),
}));
vi.mock("@dashboard/lib/inbox/convex-store", () => inbox);

import { PATCH } from "../../app/api/kody/todos/[slug]/route";

function request(phase: string, questions: string[]) {
  return new NextRequest("https://dash.test/api/kody/todos/build-healthy-ci", {
    method: "PATCH",
    body: JSON.stringify({ agencyRequest: { phase, questions } }),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("Agency request question Inbox delivery", () => {
  it("adds one durable Inbox link when Kody needs a decision", async () => {
    const response = await PATCH(
      request("waiting-information", ["May Kody replace the current CI job?"]),
      { params: Promise.resolve({ slug: "build-healthy-ci" }) },
    );

    expect(response.status).toBe(200);
    expect(inbox.appendInboxEntries).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "widgets",
      [
        expect.objectContaining({
          source: "kody",
          threadType: "AgencyRequest",
          title: "Kody needs your decision: Build Healthy CI",
          snippet: "May Kody replace the current CI job?",
          url: "https://dash.test/repo/acme/widgets/todos/build-healthy-ci",
          category: "gate-waiting",
        }),
      ],
    );
  });

  it("does not notify for ordinary Todo updates", async () => {
    await PATCH(request("monitoring", []), {
      params: Promise.resolve({ slug: "build-healthy-ci" }),
    });

    expect(inbox.appendInboxEntries).not.toHaveBeenCalled();
  });
});

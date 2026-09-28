import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  verifyRepoWriteAccess: vi.fn(),
  mutateTriggers: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  verifyRepoWriteAccess: dependencies.verifyRepoWriteAccess,
}));
vi.mock("@kody-ade/base/triggers", () => ({
  mutateTriggers: dependencies.mutateTriggers,
}));
vi.mock("../../src/dashboard/lib/activity/audit", () => ({
  recordAudit: vi.fn(),
}));

import { DELETE } from "../../app/api/kody/triggers/[id]/route";

describe("DELETE /api/kody/triggers/:id authorization", () => {
  it("does not mutate trigger state without verified repository write access", async () => {
    dependencies.verifyRepoWriteAccess.mockResolvedValue(
      NextResponse.json(
        { error: "write_permission_required" },
        { status: 403 },
      ),
    );
    const response = await DELETE(
      new NextRequest(
        "https://dashboard.example.com/api/kody/triggers/rule-1",
        {
          method: "DELETE",
        },
      ),
      { params: Promise.resolve({ id: "rule-1" }) },
    );

    expect(response.status).toBe(403);
    expect(dependencies.mutateTriggers).not.toHaveBeenCalled();
  });
});

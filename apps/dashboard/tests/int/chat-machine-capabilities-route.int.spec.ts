import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireUserAuth: vi.fn<() => Promise<NextResponse | null>>(async () => null),
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireUserAuth: mocks.requireUserAuth,
}));

import { GET } from "../../app/api/kody/chat/machines/route";

describe("chat machine capabilities route", () => {
  beforeEach(() => {
    mocks.requireUserAuth.mockResolvedValue(null);
    delete process.env.KODY_LOCAL_MACHINE_ACCESS;
  });

  it("reports Local only when the host explicitly enables it", async () => {
    process.env.KODY_LOCAL_MACHINE_ACCESS = "1";

    const response = await GET(
      new NextRequest("http://localhost/api/kody/chat/machines"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ local: true });
  });

  it("fails closed when Local is not configured", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/kody/chat/machines"),
    );

    expect(await response.json()).toEqual({ local: false });
  });

  it("requires an authenticated dashboard user", async () => {
    mocks.requireUserAuth.mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/kody/chat/machines"),
    );

    expect(response.status).toBe(401);
  });
});

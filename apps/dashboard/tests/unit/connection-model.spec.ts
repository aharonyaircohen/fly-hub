import { describe, expect, it } from "vitest";
import {
  ConnectionSchema,
  connectionAfterSave,
  connectionAfterVerification,
} from "@dashboard/lib/connections/model";

const connection = {
  id: "facebook-main",
  name: "Yair Facebook Page",
  provider: "facebook",
  accountType: "page",
  externalId: "123456789",
  credentialRefs: { accessToken: "FACEBOOK_PAGE_ACCESS_TOKEN" },
  status: "connected" as const,
  verifiedAt: "2026-08-31T12:00:00.000Z",
};

describe("Connection model", () => {
  it("accepts exactly the agreed public structure", () => {
    expect(ConnectionSchema.parse(connection)).toEqual(connection);
    expect(() =>
      ConnectionSchema.parse({ ...connection, accessToken: "secret-value" }),
    ).toThrow();
  });

  it("requires verification after identity or credential reference changes", () => {
    expect(
      connectionAfterSave(connection, {
        name: connection.name,
        externalId: "987654321",
        credentialRefs: connection.credentialRefs,
      }),
    ).toMatchObject({ status: "needs_attention", verifiedAt: null });
  });

  it("marks only successful verification as connected", () => {
    expect(
      connectionAfterVerification(connection, {
        ok: true,
        verifiedAt: "2026-09-01T10:00:00.000Z",
      }),
    ).toMatchObject({
      status: "connected",
      verifiedAt: "2026-09-01T10:00:00.000Z",
    });
    expect(
      connectionAfterVerification(connection, { ok: false }),
    ).toMatchObject({ status: "needs_attention" });
  });
});

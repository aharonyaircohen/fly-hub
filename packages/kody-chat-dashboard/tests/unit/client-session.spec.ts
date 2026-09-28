import { beforeEach, describe, expect, it } from "vitest";

import {
  mintClientSession,
  verifyClientSession,
} from "../../src/dashboard/lib/client-session/session";

const SESSION = {
  identity: {
    subject: "github:123",
    kind: "operator" as const,
    name: "A Guy",
  },
  owner: "A-Guy-educ",
  repo: "A-Guy-Teacher",
  brandSlug: "acme",
};

describe("client session", () => {
  beforeEach(() => {
    process.env.KODY_MASTER_KEY = "a".repeat(64);
  });

  it("round-trips a scoped identity without exposing the signing key", async () => {
    const token = await mintClientSession(SESSION);

    await expect(verifyClientSession(token)).resolves.toMatchObject(SESSION);
    expect(token).not.toContain(process.env.KODY_MASTER_KEY!);
  });

  it("rejects a modified token", async () => {
    const token = await mintClientSession(SESSION);
    const parts = token.split(".");
    const signature = parts[2]!;
    parts[2] = `${signature.startsWith("a") ? "b" : "a"}${signature.slice(1)}`;
    const modified = parts.join(".");

    await expect(verifyClientSession(modified)).resolves.toBeNull();
  });

  it("rejects an expired session", async () => {
    const token = await mintClientSession(SESSION, { ttlSec: -1 });

    await expect(verifyClientSession(token)).resolves.toBeNull();
  });

  it("round-trips optional display fields without changing the scoped identity", async () => {
    const session = {
      ...SESSION,
      identity: {
        ...SESSION.identity,
        email: "operator@example.com",
        image: "https://avatars.example/operator",
      },
    };

    const token = await mintClientSession(session);

    await expect(verifyClientSession(token)).resolves.toMatchObject(session);
  });
});

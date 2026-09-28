import { describe, expect, it } from "vitest";

import {
  requestOrigin,
  secureRequestOrigin,
} from "@kody-ade/base/request-origin";

describe("requestOrigin", () => {
  it("does not trust the browser Origin header for service callbacks", () => {
    const req = new Request("https://fallback.example.test/api", {
      headers: { origin: "http://localhost:3333" },
    });
    expect(requestOrigin(req)).toBe("https://fallback.example.test");
  });

  it("uses forwarded proto and host when Origin is absent", () => {
    const req = new Request("http://internal.example.test/api", {
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "dashboard.example.test",
      },
    });
    expect(requestOrigin(req)).toBe("https://dashboard.example.test");
  });

  it("falls back to the request URL origin", () => {
    const req = new Request("https://fallback.example.test/api");
    expect(requestOrigin(req)).toBe("https://fallback.example.test");
  });

  it("ignores an untrusted Host header without trusted proxy metadata", () => {
    const req = new Request("https://dashboard.example.test/api", {
      headers: { host: "foreign.example.test" },
    });
    expect(requestOrigin(req)).toBe("https://dashboard.example.test");
  });

  it("requires HTTPS for a public service callback", () => {
    const req = new Request("http://dashboard.example.test/api");
    expect(() => secureRequestOrigin(req, {})).toThrow(
      "Dashboard must be served over HTTPS",
    );
  });

  it("uses existing public Dashboard configuration for local workers", () => {
    const req = new Request("http://localhost:3333/api");
    expect(
      secureRequestOrigin(req, {
        KODY_PUBLIC_BASE_URL: "https://dashboard.example.test/path",
      }),
    ).toBe("https://dashboard.example.test");
    expect(requestOrigin(req)).toBe("http://localhost:3333");
  });

  it("accepts the mounted HTTPS origin when browser Origin is foreign", () => {
    const req = new Request("http://internal.example.test/api", {
      headers: {
        origin: "https://foreign.example.test",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "dashboard.example.test",
      },
    });
    expect(secureRequestOrigin(req)).toBe("https://dashboard.example.test");
  });
});

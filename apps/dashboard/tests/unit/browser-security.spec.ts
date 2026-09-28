import { describe, expect, it } from "vitest";

import {
  validatePublicBrowserUrl,
  type BrowserDnsResolver,
} from "@kody-ade/fly/browsers/security";
import {
  mintBrowserTicket,
  readBrowserTicket,
  verifyBrowserTicket,
} from "@kody-ade/fly/browsers/ticket";

describe("browser navigation security", () => {
  const publicDns: BrowserDnsResolver = async () => [
    { address: "93.184.216.34", family: 4 },
  ];

  it("accepts public HTTP URLs", async () => {
    await expect(
      validatePublicBrowserUrl("https://example.com/path", publicDns),
    ).resolves.toBe("https://example.com/path");
  });

  it.each([
    "file:///etc/passwd",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://169.254.169.254/latest/meta-data",
    "http://service.internal",
  ])("rejects unsafe destination %s", async (url) => {
    await expect(validatePublicBrowserUrl(url, publicDns)).rejects.toThrow(
      "browser_url_blocked",
    );
  });

  it("rejects DNS rebinding to a private address", async () => {
    await expect(
      validatePublicBrowserUrl("https://public.example", async () => [
        { address: "10.0.0.8", family: 4 },
      ]),
    ).rejects.toThrow("browser_url_blocked");
  });
});

describe("browser stream tickets", () => {
  const identity = {
    repository: "acme/app",
    actorId: "octocat",
    sessionId: "browser-1",
    machineId: "machine-1",
  };
  const key = Buffer.alloc(32, 7);

  it("binds a short-lived ticket to the exact browser session", () => {
    const { ticket } = mintBrowserTicket(identity, 60, key, 1_000);
    expect(verifyBrowserTicket(ticket, identity, key, 1_030)).toBe(true);
    expect(
      verifyBrowserTicket(
        ticket,
        { ...identity, actorId: "intruder" },
        key,
        1_030,
      ),
    ).toBe(false);
    expect(verifyBrowserTicket(ticket, identity, key, 1_061)).toBe(false);
  });

  it("authenticates the ticket before exposing its exact Machine route", () => {
    const { ticket } = mintBrowserTicket(identity, 60, key, 1_000);
    expect(readBrowserTicket(ticket, key, 1_030)).toMatchObject(identity);
    expect(readBrowserTicket(`${ticket}x`, key, 1_030)).toBeNull();
    expect(readBrowserTicket(ticket, key, 1_061)).toBeNull();
  });
});

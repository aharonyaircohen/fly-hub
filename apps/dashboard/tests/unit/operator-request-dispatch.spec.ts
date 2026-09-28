/**
 * Tests for the operator-request inbox dispatcher: title convention parsing,
 * payload extraction, and per-operator entry shape (source "request" +
 * dispatchable `@kody <slug>` command keyed to the capability's trust).
 */
import { describe, expect, it } from "vitest";
import {
  buildRequestEntries,
  requestCapabilitySlug,
  requestIssueFromPayload,
} from "@dashboard/lib/push/operator-request-dispatch";

const payload = (over: Record<string, unknown> = {}) => ({
  action: "opened",
  issue: {
    number: 8,
    title: "[operation-creator] Propose default-branch-reliability Operation",
    body: "## Capability request\n\nInvoke the `operation-creator` capability.",
    html_url: "https://github.com/acme/widgets/issues/8",
    created_at: "2026-07-16T15:20:08Z",
    user: { login: "kody-bot" },
  },
  repository: { full_name: "acme/widgets" },
  ...over,
});

describe("requestCapabilitySlug", () => {
  it("parses the bracketed capability slug", () => {
    expect(requestCapabilitySlug("[operation-creator] Propose X")).toBe(
      "operation-creator",
    );
  });

  it("rejects non-request titles", () => {
    expect(requestCapabilitySlug("Fix login bug")).toBeNull();
    expect(requestCapabilitySlug("[Not A Slug] hello")).toBeNull();
    expect(requestCapabilitySlug("[]")).toBeNull();
    expect(requestCapabilitySlug("[slug]")).toBeNull(); // no summary text
  });
});

describe("requestIssueFromPayload", () => {
  it("extracts the issue for opened request issues", () => {
    const issue = requestIssueFromPayload("issues", payload());
    expect(issue).toMatchObject({
      owner: "acme",
      repo: "widgets",
      number: 8,
      author: "kody-bot",
    });
  });

  it("ignores other events, actions, and titles", () => {
    expect(requestIssueFromPayload("issue_comment", payload())).toBeNull();
    expect(
      requestIssueFromPayload("issues", payload({ action: "closed" })),
    ).toBeNull();
    expect(
      requestIssueFromPayload(
        "issues",
        payload({
          issue: {
            number: 9,
            title: "Plain bug report",
            html_url: "https://github.com/acme/widgets/issues/9",
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("buildRequestEntries", () => {
  it("emits one approvable entry per operator", () => {
    const issue = requestIssueFromPayload("issues", payload())!;
    const entries = buildRequestEntries(issue, ["alice", "bob"]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "operator-request:alice:acme/widgets#8",
      login: "alice",
      source: "request",
      threadType: "Issue",
      ctoAction: "request",
      ctoCommand: "@kody operation-creator",
      ctoCapability: "operation-creator",
    });
    expect(entries[0]!.snippet).toContain("Capability request");
    expect(entries[0]!.snippet).not.toContain("#");
  });
});

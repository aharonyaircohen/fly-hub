import { describe, expect, it } from "vitest";

import {
  CHANNEL_TYPES,
  NOTIFICATION_EVENTS,
  channelTypeLabel,
  defaultTemplateForEvent,
  eventLabel,
  isNotificationEvent,
  parseManifestBody,
  renderTemplate,
  serializeManifestBody,
  slugifyRuleName,
  uniqueRuleId,
  type NotificationRule,
  type NotificationsManifest,
} from "@dashboard/lib/notifications";

function rule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: "r1",
    name: "Deploys",
    enabled: true,
    event: "deploy_pr_merged",
    channel: { type: "slack-webhook", url: "https://hooks.slack.test/x" },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("serialize + parse roundtrip", () => {
  it("roundtrips a manifest through the issue body format", () => {
    const manifest: NotificationsManifest = { version: 1, rules: [rule()] };
    const body = serializeManifestBody(manifest);
    expect(body).toContain("<!-- kody-notifications-start -->");
    expect(parseManifestBody(body)).toEqual(manifest);
  });

  it("roundtrips every channel type", () => {
    const channels: NotificationRule["channel"][] = [
      { type: "slack-webhook", url: "https://s" },
      { type: "discord-webhook", url: "https://d" },
      { type: "telegram-bot", botToken: "t", chatId: "c" },
      {
        type: "generic-webhook",
        url: "https://g",
        jsonTemplate: '{"a":1}',
        bodyFormat: "form",
        headers: { "x-key": "v" },
      },
      { type: "web-push" },
    ];
    const manifest: NotificationsManifest = {
      version: 1,
      rules: channels.map((channel, i) =>
        rule({ id: `r${i}`, channel }),
      ),
    };
    expect(parseManifestBody(serializeManifestBody(manifest))).toEqual(
      manifest,
    );
  });
});

describe("parseManifestBody defensiveness", () => {
  const empty = { version: 1, rules: [] };

  it("returns an empty manifest for missing/None bodies", () => {
    expect(parseManifestBody(null)).toEqual(empty);
    expect(parseManifestBody(undefined)).toEqual(empty);
    expect(parseManifestBody("")).toEqual(empty);
  });

  it("returns an empty manifest when markers or fences are broken", () => {
    expect(parseManifestBody("no markers here")).toEqual(empty);
    expect(
      parseManifestBody(
        "<!-- kody-notifications-end -->x<!-- kody-notifications-start -->",
      ),
    ).toEqual(empty);
    expect(
      parseManifestBody(
        "<!-- kody-notifications-start -->\nno fence\n<!-- kody-notifications-end -->",
      ),
    ).toEqual(empty);
    expect(
      parseManifestBody(
        "<!-- kody-notifications-start -->\n```json\n{ bad json\n```\n<!-- kody-notifications-end -->",
      ),
    ).toEqual(empty);
  });

  it("drops rules with missing ids, unknown events, or bad channels", () => {
    const manifest = {
      version: 1,
      rules: [
        rule(),
        { ...rule({ id: "r2" }), event: "unknown_event" },
        { ...rule({ id: "r3" }), channel: { type: "slack-webhook", url: "" } },
        { ...rule({ id: "r4" }), channel: { type: "mystery" } },
        { name: "no id", event: "ci_failed" },
        null,
        "string-rule",
      ],
    };
    const body = serializeManifestBody(manifest as never);
    const parsed = parseManifestBody(body);
    expect(parsed.rules.map((r) => r.id)).toEqual(["r1"]);
  });

  it("defaults enabled to true unless explicitly false", () => {
    const body = serializeManifestBody({
      version: 1,
      rules: [
        rule({ id: "on", enabled: undefined as never }),
        rule({ id: "off", enabled: false }),
      ],
    });
    const parsed = parseManifestBody(body);
    expect(parsed.rules.find((r) => r.id === "on")?.enabled).toBe(true);
    expect(parsed.rules.find((r) => r.id === "off")?.enabled).toBe(false);
  });

  it("sanitizes generic-webhook extras: non-string headers dropped, json format omitted", () => {
    const body = serializeManifestBody({
      version: 1,
      rules: [
        rule({
          id: "g",
          channel: {
            type: "generic-webhook",
            url: "https://g",
            bodyFormat: "json",
            headers: { good: "v", bad: 42 } as never,
          },
        }),
      ],
    });
    const parsed = parseManifestBody(body);
    expect(parsed.rules[0]!.channel).toEqual({
      type: "generic-webhook",
      url: "https://g",
      headers: { good: "v" },
    });
  });

  it("requires both botToken and chatId for telegram", () => {
    const body = serializeManifestBody({
      version: 1,
      rules: [
        rule({
          id: "t",
          channel: { type: "telegram-bot", botToken: "t", chatId: "" } as never,
        }),
      ],
    });
    expect(parseManifestBody(body).rules).toEqual([]);
  });
});

describe("helpers", () => {
  it("isNotificationEvent accepts declared events only", () => {
    for (const e of NOTIFICATION_EVENTS) expect(isNotificationEvent(e)).toBe(true);
    expect(isNotificationEvent("nope")).toBe(false);
    expect(isNotificationEvent(42)).toBe(false);
  });

  it("slugifyRuleName slugifies with a fallback", () => {
    expect(slugifyRuleName("Deploy PR Merged!")).toBe("deploy-pr-merged");
    expect(slugifyRuleName("!!!")).toBe("rule");
  });

  it("uniqueRuleId suffixes until free", () => {
    const existing = [rule({ id: "a" }), rule({ id: "a-2" })];
    expect(uniqueRuleId("b", existing)).toBe("b");
    expect(uniqueRuleId("a", existing)).toBe("a-3");
  });

  it("renderTemplate substitutes known vars and keeps unknown tokens", () => {
    expect(
      renderTemplate("{{repo}} v{{version}} by {{who}}", {
        repo: "acme/app",
        version: "1.2.3",
      }),
    ).toBe("acme/app v1.2.3 by {{who}}");
  });

  it("every event has a default template and a label", () => {
    for (const e of NOTIFICATION_EVENTS) {
      expect(defaultTemplateForEvent(e)).toContain("{{repo}}");
      expect(eventLabel(e).length).toBeGreaterThan(0);
    }
  });

  it("every channel type has a label", () => {
    for (const t of CHANNEL_TYPES) {
      expect(channelTypeLabel(t).length).toBeGreaterThan(0);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  NotificationChannelSchema,
  NotificationCreateRuleSchema,
  NotificationPatchRuleSchema,
  NotificationTestSchema,
} from "@dashboard/lib/notifications";

describe("shared notification input schemas", () => {
  it("enforces provider-specific webhook hosts everywhere", () => {
    expect(
      NotificationChannelSchema.safeParse({
        type: "slack-webhook",
        url: "https://example.com/not-slack",
      }).success,
    ).toBe(false);
    expect(
      NotificationChannelSchema.safeParse({
        type: "slack-webhook",
        url: "https://hooks.slack.com/services/a/b/c",
      }).success,
    ).toBe(true);
  });

  it("reuses the channel contract for create, patch, and test", () => {
    const invalidChannel = {
      type: "discord-webhook" as const,
      url: "https://example.com/not-discord",
    };
    expect(
      NotificationCreateRuleSchema.safeParse({
        name: "CI",
        event: "ci_failed",
        channel: invalidChannel,
      }).success,
    ).toBe(false);
    expect(
      NotificationPatchRuleSchema.safeParse({ channel: invalidChannel })
        .success,
    ).toBe(false);
    expect(
      NotificationTestSchema.safeParse({
        channel: invalidChannel,
        text: "test",
      }).success,
    ).toBe(false);
  });
});

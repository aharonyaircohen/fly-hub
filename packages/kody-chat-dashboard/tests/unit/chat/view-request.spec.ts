/**
 * @testFramework vitest
 * @domain kody-chat
 */
import { describe, expect, it } from "vitest";
import {
  buildExplicitViewRequestInstruction,
  parseExplicitViewRequest,
} from "../../../app/api/kody/chat/kody/view-request";

describe("explicit view requests", () => {
  it("parses an explicit UI prompt without treating it as issue creation", () => {
    expect(parseExplicitViewRequest("Show decision UI:\nCreate this?")).toEqual(
      {
        purpose: "decision",
        title: "Create this?",
      },
    );
  });

  it("parses a natural explicit show_view card request", () => {
    expect(
      parseExplicitViewRequest(
        "Render a compact visual card titled Renderer compatibility check with three steps: Alpha, Beta, Gamma. Do not start a Guided Flow. Use show_view.",
      ),
    ).toEqual({
      purpose: "renderer-compatibility-check",
      title: "Renderer compatibility check",
    });
  });

  it("does not hardcode natural wording as an explicit renderer request", () => {
    expect(
      parseExplicitViewRequest(
        "ask the user to choose one item from a list\n\nop 1\nop2\nop 3",
      ),
    ).toBeNull();
  });

  it("builds a force-tool instruction for the parsed request", () => {
    const request = parseExplicitViewRequest("Show decision UI:\nCreate this?");

    expect(request).not.toBeNull();
    expect(buildExplicitViewRequestInstruction(request!)).toContain(
      "Your next action must be a show_view tool call.",
    );
    expect(buildExplicitViewRequestInstruction(request!)).toContain(
      'Render the view named "decision"',
    );
    expect(buildExplicitViewRequestInstruction(request!)).toContain(
      'Use the title: "Create this?".',
    );
  });
});

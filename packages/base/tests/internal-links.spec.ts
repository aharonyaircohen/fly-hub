import { describe, expect, it } from "vitest";

import {
  formatInternalLinks,
  isSafeInternalHref,
  shouldInterceptInternalLinkClick,
  stripConflictingInternalLinks,
  stripUntrustedMarkdownLinks,
} from "../src/internal-links";

describe("internal chat links", () => {
  it("formats validated internal links as Markdown", () => {
    expect(
      formatInternalLinks([
        { href: "/repo/acme/app/todos/launch", label: "Open todo: launch" },
      ]),
    ).toBe("[Open todo: launch](/repo/acme/app/todos/launch)");
  });

  it("rejects external and protocol-relative destinations", () => {
    expect(isSafeInternalHref("https://example.com")).toBe(false);
    expect(isSafeInternalHref("//example.com")).toBe(false);
    expect(isSafeInternalHref("/repo/acme/app/todos/launch")).toBe(true);
    expect(
      formatInternalLinks([{ href: "javascript:alert(1)", label: "Bad" }]),
    ).toBe("");
  });

  it("only intercepts ordinary clicks on safe internal destinations", () => {
    expect(
      shouldInterceptInternalLinkClick({ href: "/repo/acme/app/todos/test" }),
    ).toBe(true);
    expect(
      shouldInterceptInternalLinkClick({ href: "#section" }),
    ).toBe(false);
    expect(
      shouldInterceptInternalLinkClick({
        href: "/repo/acme/app/todos/test",
        target: "_blank",
      }),
    ).toBe(false);
    expect(
      shouldInterceptInternalLinkClick({
        href: "/repo/acme/app/todos/test",
        metaKey: true,
      }),
    ).toBe(false);
  });

  it("keeps only the canonical destination for a known link label", () => {
    expect(
      stripConflictingInternalLinks(
        "[Open todo: test](https://repo.example/todos/test)",
        [{ href: "/repo/acme/app/todos/test", label: "Open todo: test" }],
      ),
    ).toBe("");
  });

  it("keeps tool links authoritative over model-invented destinations", () => {
    expect(
      stripUntrustedMarkdownLinks(
        "[Open New Todo List](https://repo.example/todos/todo-new)",
        [
          {
            href: "/repo/acme/app/todos/new-todo-list",
            label: "Open todo: new-todo-list",
          },
        ],
      ),
    ).toBe("Open New Todo List");
  });
});

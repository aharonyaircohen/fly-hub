import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  previewChatContextBlock,
  remotePageChatContextBlock,
} from "@dashboard/lib/previews/chat-context";
import type { PreviewEnvironment } from "@kody-ade/fly/preview-environments";

describe("previewChatContextBlock", () => {
  it("returns null when there is no active preview", () => {
    expect(previewChatContextBlock(null)).toBeNull();
  });

  it("describes an uploaded preview with its file outline", () => {
    const env: PreviewEnvironment = {
      id: "landing",
      label: "landing.html",
      url: "https://kp-landing.fly.dev",
      staticId: "abc123",
      expiresAt: 1_700_000_000_000,
      uploadContext: {
        name: "landing.html",
        mimeType: "text/html",
        size: 2048,
        title: "Landing",
        outline: "h1: Welcome\nbutton: Start",
      },
    };

    const block = previewChatContextBlock(env);

    expect(block).toContain("uploaded preview");
    expect(block).toContain("landing.html");
    expect(block).toContain("https://kp-landing.fly.dev");
    expect(block).toContain("Landing");
    expect(block).toContain("button: Start");
  });

  it("describes plain preview environments too", () => {
    const block = previewChatContextBlock({
      id: "prod",
      label: "Production",
      url: "https://prod.example.com",
    });

    expect(block).toContain("Production");
    expect(block).toContain("https://prod.example.com");
    expect(block).not.toContain("Uploaded file");
  });

  it("puts repo-backed static view source before the preview URL", () => {
    const block = previewChatContextBlock({
      id: "mobile",
      label: "Mobile HTML",
      url: "/api/kody/views/mobile-html-1234/index.html",
      repoViewPath: "views/mobile-html-1234",
      repoViewEntryPath: "index.html",
      repoViewSourceUrl:
        "https://github.com/acme/backend-store/blob/main/app/views/mobile-html-1234/index.html",
    });

    expect(block).toContain("Source path: views/mobile-html-1234");
    expect(block).toContain("Entry file: index.html");
    expect(block).toContain(
      "Source URL: https://github.com/acme/backend-store/blob/main/app/views/mobile-html-1234/index.html",
    );
    expect(block).toContain(
      "Preview URL: /api/kody/views/mobile-html-1234/index.html",
    );
    expect(block!.indexOf("Source URL")).toBeLessThan(
      block!.indexOf("Preview URL"),
    );
  });

  it("describes Fly branch previews without requiring a URL", () => {
    const block = previewChatContextBlock({
      id: "dev",
      label: "dev",
      flyBranch: { repo: "owner/repo", branch: "dev" },
    });

    expect(block).toContain("Fly branch preview");
    expect(block).toContain("owner/repo");
    expect(block).toContain("dev");
    expect(block).not.toContain("Preview URL");
  });
});

describe("remotePageChatContextBlock", () => {
  it("describes the live page rendered inside the Fly browser", () => {
    const block = remotePageChatContextBlock({
      url: "https://www.iana.org/help/example-domains",
      title: "IANA-managed Reserved Domains",
      data: {
        snapshot: {
          text: "Example domains are provided for illustrative examples.",
          elements: [
            {
              ref: "e1",
              tag: "a",
              name: "Further Reading",
              selector: "main > a",
            },
          ],
        },
      },
    });

    expect(block).toContain("live page currently visible");
    expect(block).toContain("https://www.iana.org/help/example-domains");
    expect(block).toContain("IANA-managed Reserved Domains");
    expect(block).toContain("Example domains are provided");
    expect(block).toContain("Further Reading");
  });

  it("returns null when the browser result has no page evidence", () => {
    expect(remotePageChatContextBlock({ ok: true })).toBeNull();
  });

  it("collects one fresh Fly snapshot immediately before chat sends", () => {
    const workspace = readFileSync(
      fileURLToPath(
        new URL(
          "../../src/dashboard/features/previews/components/PreviewWorkspace.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const browser = readFileSync(
      fileURLToPath(
        new URL(
          "../../src/dashboard/features/previews/components/PreviewBrowser.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    const chat = readFileSync(
      fileURLToPath(
        new URL(
          "../../../../packages/kody-chat-dashboard/src/dashboard/lib/components/KodyChat.tsx",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    expect(workspace).toContain("onRemoteActionRunnerChange={");
    expect(chat).toContain('await liveRunner({ op: "wait", ms: 0 })');
    expect(chat).toContain("parts.push(formatPageInfo(livePage.info))");
    expect(browser).not.toMatch(/setInterval\(syncRemotePage/);
  });
});

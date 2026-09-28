import { describe, expect, it } from "vitest";
import type {
  Memory,
  MemoryRevision,
} from "../../src/dashboard/lib/api/memory";
import {
  filterMemories,
  memoryFilePath,
  memoryIdFromFilePath,
  memoryMarkdown,
} from "../../src/dashboard/features/memory/lib/memory-files";

const memory: Memory = {
  id: "memory-runtime-owner",
  scope: { kind: "repository", tenantId: "acme/widgets" },
  kind: "decision",
  content: {
    title: "Runtime owner",
    summary: "Convex owns runtime state.",
    body: "Do not use GitHub as a runtime fallback.",
  },
  currentRevisionId: "revision-2",
  status: "active",
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T11:00:00.000Z",
};

const revisions: MemoryRevision[] = [
  {
    id: "revision-1",
    memoryId: memory.id,
    previousRevisionId: null,
    kind: "decision",
    content: memory.content,
    evidence: [{ source: "user-input", id: "request-1" }],
    reason: "Approved decision.",
    actor: { kind: "user", id: "github:1" },
    createdAt: memory.createdAt,
  },
  {
    id: "revision-2",
    memoryId: memory.id,
    previousRevisionId: "revision-1",
    kind: "decision",
    content: memory.content,
    evidence: [{ source: "conversation", id: "conversation-1" }],
    reason: "Clarified ownership.",
    actor: { kind: "user", id: "github:1" },
    createdAt: memory.updatedAt,
  },
];

describe("memory file projection", () => {
  it("uses stable scope and kind folders while keeping the memory id as identity", () => {
    expect(memoryFilePath(memory)).toBe(
      "repository/decision/memory-runtime-owner.md",
    );
    expect(
      memoryFilePath({
        ...memory,
        scope: { kind: "user", userId: "github:1" },
        kind: "preference",
      }),
    ).toBe("personal/preference/memory-runtime-owner.md");
    expect(
      memoryIdFromFilePath("repository/decision/memory-runtime-owner.md"),
    ).toBe("memory-runtime-owner");
  });

  it("rejects folders and malformed memory paths", () => {
    expect(memoryIdFromFilePath("repository/decision")).toBeNull();
    expect(memoryIdFromFilePath("memory-runtime-owner.md")).toBeNull();
    expect(
      memoryIdFromFilePath("organization/decision/memory-runtime-owner.md"),
    ).toBeNull();
    expect(
      memoryIdFromFilePath("repository/note/memory-runtime-owner.md"),
    ).toBeNull();
    expect(
      memoryIdFromFilePath("repository/decision/memory-runtime-owner.txt"),
    ).toBeNull();
    expect(memoryIdFromFilePath("repository/decision/INVALID.md")).toBeNull();
    expect(
      memoryIdFromFilePath("../decision/memory-runtime-owner.md"),
    ).toBeNull();
  });

  it("renders typed content, evidence, and revision history", () => {
    const markdown = memoryMarkdown(memory, revisions);

    expect(markdown).toContain("# Runtime owner");
    expect(markdown).toContain("**Kind:** Decision");
    expect(markdown).toContain("**Scope:** Repository — acme/widgets");
    expect(markdown).toContain("Do not use GitHub as a runtime fallback.");
    expect(markdown).toContain("## Evidence");
    expect(markdown).toContain("conversation — `conversation-1`");
    expect(markdown).toContain("## Revision history");
    expect(markdown).toContain("Clarified ownership.");
    expect(markdown).toContain("Approved decision.");
  });

  it("renders a clear empty state for missing evidence and history", () => {
    const markdown = memoryMarkdown(memory, []);

    expect(markdown).toContain("No evidence recorded.");
    expect(markdown).toContain("No revisions recorded.");
  });

  it("renders personal scope, expiration, and complete evidence links", () => {
    const personal: Memory = {
      ...memory,
      scope: { kind: "user", userId: "github:1" },
      expiresAt: "2027-01-01T00:00:00.000Z",
    };
    const linkedRevision: MemoryRevision = {
      ...revisions[0],
      evidence: [
        {
          source: "document",
          id: "document-1",
          conversationId: "conversation-1",
          uri: "https://example.test/document-1",
        },
      ],
    };

    const markdown = memoryMarkdown(personal, [linkedRevision]);

    expect(markdown).toContain("**Scope:** Personal — github:1");
    expect(markdown).toContain("**Expires:** 2027-01-01T00:00:00.000Z");
    expect(markdown).toContain("conversation `conversation-1`");
    expect(markdown).toContain("https://example.test/document-1");
  });

  it("searches typed memory content and scope without case sensitivity", () => {
    const personal: Memory = {
      ...memory,
      id: "memory-personal",
      scope: { kind: "user", userId: "github:1" },
      kind: "preference",
      content: {
        title: "Reply style",
        summary: "Prefers concise answers.",
        body: "Use simple words.",
      },
    };

    expect(filterMemories([memory, personal], "CONVEX")).toEqual([memory]);
    expect(filterMemories([memory, personal], "preference")).toEqual([
      personal,
    ]);
    expect(filterMemories([memory, personal], "github:1")).toEqual([personal]);
    expect(filterMemories([memory, personal], "  ")).toEqual([
      memory,
      personal,
    ]);
  });
});

import { describe, expect, it } from "vitest";

import {
  createFileSpace,
  normalizeFileSpaces,
  reorderFileSpaces,
  updateFileSpace,
} from "@dashboard/features/file-spaces/model";

describe("file spaces", () => {
  it("always exposes Docs as the built-in first space", () => {
    expect(normalizeFileSpaces(undefined)).toEqual([
      {
        id: "docs",
        title: "Docs",
        slug: "docs",
        rootPath: "docs",
        builtIn: true,
      },
    ]);
  });

  it("derives a stable route and repository folder from the title", () => {
    const space = createFileSpace("Team Notes", []);

    expect(space).toMatchObject({
      title: "Team Notes",
      slug: "team-notes",
      rootPath: "team-notes",
    });
    expect(space.id).toBe("team-notes");
  });

  it("rejects reserved and duplicate slugs", () => {
    expect(() => createFileSpace("Docs", [])).toThrow("reserved");
    expect(() =>
      createFileSpace("Notes", [createFileSpace("Notes", [])]),
    ).toThrow("already exists");
  });

  it("drops persisted spaces with unsafe routes or repository paths", () => {
    expect(
      normalizeFileSpaces([
        { id: "safe", title: "Safe", slug: "safe", rootPath: "safe" },
        { id: "escape", title: "Escape", slug: "escape", rootPath: "../secrets" },
        { id: "nested", title: "Nested", slug: "nested/path", rootPath: "nested/path" },
      ]),
    ).toEqual([
      expect.objectContaining({ id: "docs" }),
      expect.objectContaining({ id: "safe" }),
    ]);
  });

  it("renames only the display title so links and folders stay stable", () => {
    const original = createFileSpace("Notes", []);

    expect(updateFileSpace(original, { title: "Research" })).toMatchObject({
      title: "Research",
      slug: "notes",
      rootPath: "notes",
    });
  });

  it("reorders custom spaces only when every id is present once", () => {
    const notes = createFileSpace("Notes", []);
    const research = createFileSpace("Research", [notes]);

    expect(reorderFileSpaces([notes, research], [research.id, notes.id])).toEqual([
      research,
      notes,
    ]);
    expect(() => reorderFileSpaces([notes, research], [notes.id])).toThrow(
      "every file space",
    );
  });
});

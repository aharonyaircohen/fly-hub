import { existsSync, readdirSync, readFileSync } from "node:fs";
const FEATURE_ROOTS = readdirSync(join(process.cwd(), "src/dashboard/features")).map(
  (f) => join("src/dashboard/features", f, "components"),
);
const componentDir = (file: string) => {
  for (const dir of ["src/dashboard/lib/components", ...FEATURE_ROOTS]) {
    if (existsSync(join(process.cwd(), dir, file))) return dir;
  }
  return "src/dashboard/lib/components";
};

import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readComponent = (name: string) =>
  readFileSync(
    join(process.cwd(), componentDir(name), name),
    "utf8",
  );

describe("preview branch URL resolution", () => {
  it("only opens branch previews once status returns a live signed URL", () => {
    for (const file of ["PreviewWorkspace.tsx", "VibePage.tsx"]) {
      const source = readComponent(file);

      expect(source, file).toContain("fetchBranchPreviews");
      expect(source, file).toContain("branchPreviewNeedsPoll");
      expect(source, file).toContain("BRANCH_PREVIEW_POLL_MS");
      expect(source, file).not.toContain("mintBranchPreviewUrl");
      expect(source, file).not.toContain("kody-branch-preview-ticket");
      expect(source, file).toMatch(
        /refetchInterval:\s*\(query\)\s*=>[\s\S]*branchPreviewNeedsPoll/,
      );
      expect(source, file).toMatch(
        /\? \(resolvedBranchPreview\?\.url \?\? null\)/,
      );
    }
  });
});

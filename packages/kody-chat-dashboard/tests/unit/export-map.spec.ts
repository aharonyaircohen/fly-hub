import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Characterization test for the package's public API surface.
 *
 * Pins the export map in package.json: every export subpath must resolve to
 * an existing file. Wildcard exports are expanded against the filesystem and
 * must match at least one file. This is the safety net for the legacy
 * consolidation — deleting or moving a file that the export map points at
 * fails here before it fails in a consuming build.
 */

const pkgRoot = resolve(__dirname, "../..");
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
  exports: Record<string, string>;
};

const entries = Object.entries(pkg.exports);
const explicit = entries.filter(([, target]) => !target.includes("*"));
const wildcard = entries.filter(([, target]) => target.includes("*"));

describe("package export map", () => {
  it("has the expected shape (string targets, relative paths)", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [subpath, target] of entries) {
      expect(subpath.startsWith("./"), `subpath ${subpath}`).toBe(true);
      expect(typeof target).toBe("string");
      expect(target.startsWith("./"), `target ${target}`).toBe(true);
    }
  });

  it.each(explicit)(
    "explicit export %s resolves to an existing file",
    (subpath, target) => {
      expect(existsSync(join(pkgRoot, target)), `${subpath} -> ${target}`).toBe(
        true,
      );
    },
  );

  it.each(wildcard)(
    "wildcard export %s matches at least one file",
    (subpath, target) => {
      // target like ./src/dashboard/lib/chat/platform/*.ts — check the directory exists
      // and contains at least one file matching the suffix.
      const starIdx = target.indexOf("*");
      const dir = join(pkgRoot, target.slice(0, starIdx));
      const suffix = target.slice(starIdx + 1);
      expect(existsSync(dir), `${subpath}: directory ${dir} missing`).toBe(
        true,
      );
      const hasMatch = (d: string, depth: number): boolean => {
        if (depth > 3) return false;
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.isFile() && (suffix === "" || join(d, e.name).endsWith(suffix)))
            return true;
          if (e.isDirectory() && hasMatch(join(d, e.name), depth + 1))
            return true;
        }
        return false;
      };
      expect(hasMatch(dir, 0), `${subpath}: no file matches ${target}`).toBe(
        true,
      );
    },
  );
});

describe("export map runtime resolution (non-route .ts entries)", () => {
  // Routes and .tsx pages/components carry Next/server-only side effects;
  // their behavior is pinned by the route int specs. Here we pin that the
  // pure library entries import cleanly.
  const importable = explicit.filter(
    ([, target]) => target.endsWith(".ts") && !target.startsWith("./app/"),
  );

  it.each(importable)(
    "%s imports without throwing",
    async (_subpath, target) => {
      await expect(import(join(pkgRoot, target))).resolves.toBeDefined();
    },
  );
});

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(__dirname, "../..");
const releaseRoot = resolve(packageRoot, "../kody-chat");
const chatCoreRoot = resolve(packageRoot, "src/dashboard/lib/chat/core");
const productionRoots = [
  resolve(packageRoot, "app"),
  resolve(packageRoot, "src"),
];
const dashboardImportPrefix = ["@dashboard", "/"].join("");

function readReleaseFile(path: string): string {
  return readFileSync(resolve(releaseRoot, path), "utf8");
}

function readSourceTree(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) return [readSourceTree(path)];
      return /\.(?:ts|tsx)$/.test(entry.name)
        ? [readFileSync(path, "utf8")]
        : [];
    })
    .join("\n");
}

describe("external package boundary", () => {
  it("separates the public package from the Dashboard integration package", () => {
    const internalManifest = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8"),
    ) as { name: string; private?: boolean };
    const publicManifest = JSON.parse(readReleaseFile("package.json")) as {
      name: string;
      private?: boolean;
    };

    expect(internalManifest).toMatchObject({
      name: "@kody-ade/kody-chat-dashboard",
      private: true,
    });
    expect(publicManifest).toMatchObject({
      name: "@kody-ade/kody-chat",
    });
    expect(publicManifest.private).not.toBe(true);
  });

  it("uses the public chat frame for the Dashboard surface", () => {
    const surface = readFileSync(
      resolve(
        packageRoot,
        "src/dashboard/lib/chat/surface/ChatSurfaceLayout.tsx",
      ),
      "utf8",
    );

    expect(surface).toContain(
      'import { KodyChatFrame } from "@kody-ade/kody-chat/react"',
    );
    expect(surface).toContain("<KodyChatFrame");
  });

  it("exposes host context bridges so embedded surfaces use the host's live state", () => {
    const authContext = readFileSync(
      resolve(packageRoot, "src/dashboard/lib/auth-context.tsx"),
      "utf8",
    );
    const themeContext = readFileSync(
      resolve(packageRoot, "src/dashboard/providers/Theme/index.tsx"),
      "utf8",
    );
    const kodyChat = readFileSync(
      resolve(packageRoot, "src/dashboard/lib/components/KodyChat.tsx"),
      "utf8",
    );

    expect(authContext).toContain("export function KodyAuthBridgeProvider");
    expect(themeContext).toContain("export const KodyThemeBridgeProvider");
    expect(kodyChat).toContain("actorLogin ?? auth?.user.login ?? null");
  });

  it("publishes only documented compiled entry points", () => {
    const manifest = JSON.parse(readReleaseFile("package.json")) as {
      files: string[];
      exports: Record<string, unknown>;
    };

    expect(manifest.files).toEqual([
      "dist",
      "styles.css",
      "README.md",
      "LICENSE",
    ]);
    expect(Object.keys(manifest.exports)).toEqual([
      ".",
      "./react",
      "./core",
      "./styles.css",
    ]);
    expect(existsSync(resolve(releaseRoot, "src/model-catalog.ts"))).toBe(false);
  });

  it("declares public release metadata and React compatibility", () => {
    const manifest = JSON.parse(readReleaseFile("package.json")) as {
      license: string;
      peerDependencies: Record<string, string>;
      publishConfig: { access: string };
    };

    expect(manifest.license).toBe("MIT");
    expect(manifest.publishConfig.access).toBe("public");
    expect(manifest.peerDependencies).toEqual({
      react: ">=18 <20",
      "react-dom": ">=18 <20",
    });
    expect(readReleaseFile("LICENSE")).toContain("MIT License");
  });

  it("has no workspace or unpublished Kody runtime dependencies", () => {
    const manifestText = readReleaseFile("package.json");

    expect(manifestText).not.toContain("workspace:");
    expect(manifestText).not.toContain(dashboardImportPrefix);
    expect(manifestText).not.toContain("@kody-ade/agency");
  });

  it("keeps public source independent from Dashboard and Kody internals", () => {
    const publicSource = [
      readReleaseFile("src/core.ts"),
      readReleaseFile("src/react.tsx"),
      readReleaseFile("src/index.ts"),
    ].join("\n");

    expect(publicSource).not.toContain(dashboardImportPrefix);
    expect(publicSource).not.toContain("@kody-ade/");
  });

  it("keeps the production chat core independent from Dashboard", () => {
    const coreSource = readSourceTree(chatCoreRoot);

    expect(coreSource).not.toContain(dashboardImportPrefix);
    expect(coreSource).not.toContain("@kody-ade/");
  });

  it("keeps all production package source independent from Dashboard", () => {
    const productionSource = productionRoots.map(readSourceTree).join("\n");

    expect(productionSource).not.toContain(dashboardImportPrefix);
  });
});

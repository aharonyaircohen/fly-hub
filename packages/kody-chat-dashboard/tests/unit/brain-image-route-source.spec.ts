/**
 * @fileoverview Source-level guard for Brain image save route wiring.
 * @testFramework vitest
 * @domain brain
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_SOURCE = readFileSync(
  resolve(__dirname, "../../../brain/src/routes/image.ts"),
  "utf8",
);
const IMAGE_SAVE_COMMAND_SOURCE = readFileSync(
  resolve(__dirname, "../../../brain/src/image-save-command.ts"),
  "utf8",
);
const IMAGE_MANAGEMENT_SOURCE = readFileSync(
  resolve(__dirname, "../../../brain/src/image-management.ts"),
  "utf8",
);
const BRIDGE_EXEC_CLIENT_SOURCE = readFileSync(
  resolve(__dirname, "../../../terminal/src/bridge-exec-client.ts"),
  "utf8",
);
const PROVISION_SOURCES = [
  "../../../brain/src/routes/provision.ts",
  "../../../brain/src/routes/login.ts",
  "../../app/api/kody/chat/brain-fly/route.ts",
].map((file) => readFileSync(resolve(__dirname, file), "utf8"));
const APPLY_ROUTE_SOURCE = readFileSync(
  resolve(__dirname, "../../../brain/src/routes/image-apply.ts"),
  "utf8",
);
const APPLY_SERVICE_SOURCE = readFileSync(
  resolve(__dirname, "../../../brain/src/image-apply.ts"),
  "utf8",
);
const WORKER_ROUTE_SOURCE = readFileSync(
  resolve(__dirname, "../../../../apps/dashboard/app/api/kody/brain/image/worker/route.ts"),
  "utf8",
);

describe("Brain image save route", () => {
  it("exports Brain state through the terminal bridge and records a GHCR image ref", () => {
    expect(ROUTE_SOURCE).toContain("/api/kody/brain/image");
    expect(ROUTE_SOURCE).toContain("startBrainImageSave");
    expect(ROUTE_SOURCE).toContain("readBrainImageManagement");
    expect(ROUTE_SOURCE).toContain("pollBrainImageSave");
    expect(ROUTE_SOURCE).not.toContain("selectBrainImageRef");
    expect(ROUTE_SOURCE).not.toContain("export async function PATCH");
    expect(ROUTE_SOURCE).toContain("deleteBrainImageRef");
    expect(ROUTE_SOURCE).not.toContain("forgetBrainImageRef");
    expect(IMAGE_SAVE_COMMAND_SOURCE).toContain(
      "ensureServerProviderTerminalBridge",
    );
    expect(IMAGE_SAVE_COMMAND_SOURCE).toContain(
      "startTerminalBridgeLocalExecJob",
    );
    expect(IMAGE_MANAGEMENT_SOURCE).toContain("getTerminalBridgeExecJob");
    expect(BRIDGE_EXEC_CLIENT_SOURCE).toContain("/exec");
    expect(BRIDGE_EXEC_CLIENT_SOURCE).toContain("/jobs");
    expect(IMAGE_SAVE_COMMAND_SOURCE).toContain("brainImageBuildCommand");
    expect(IMAGE_SAVE_COMMAND_SOURCE).toContain("brainGhcrImageRef");
    expect(IMAGE_SAVE_COMMAND_SOURCE).toContain("brainGhcrAuth");
    expect(IMAGE_SAVE_COMMAND_SOURCE).toContain("ghcrToken: ghcr.token");
    expect(IMAGE_MANAGEMENT_SOURCE).toContain("writeBrainImageSave");
    expect(IMAGE_MANAGEMENT_SOURCE).toContain("readBrainImageSave");
    expect(IMAGE_MANAGEMENT_SOURCE).toContain("clearBrainImageSave");
    expect(ROUTE_SOURCE).toContain("export async function GET");
    expect(IMAGE_SAVE_COMMAND_SOURCE).toContain("resolveBrainService");
    expect(IMAGE_SAVE_COMMAND_SOURCE).not.toContain("machineIdOverride");
    expect(IMAGE_SAVE_COMMAND_SOURCE).not.toContain(
      "appNameOverride: parsed.data.app",
    );
    expect(IMAGE_SAVE_COMMAND_SOURCE).toContain("brainImageBuildCommand({");
    expect(IMAGE_SAVE_COMMAND_SOURCE).toContain("orgSlug: brain.orgSlug,");
    expect(BRIDGE_EXEC_CLIENT_SOURCE).toContain("local: true");
    expect(IMAGE_MANAGEMENT_SOURCE).toContain("readBrainImage");
    expect(IMAGE_MANAGEMENT_SOURCE).toContain("writeBrainImage");
    expect(ROUTE_SOURCE).not.toContain("brain_app_mismatch");
  });

  it("keeps image apply explicit and out of normal Brain provision paths", () => {
    for (const source of PROVISION_SOURCES) {
      expect(source).toContain("manageBrainServer");
      expect(source).not.toContain("readBrainImage");
      expect(source).not.toContain("prepareBrainRuntimeImage");
      expect(source).not.toContain("resolveRuntimeImageRef");
      expect(source).not.toContain("prepareRuntimeImage");
    }
    expect(APPLY_ROUTE_SOURCE).toContain("enqueueRestore");
    expect(APPLY_ROUTE_SOURCE).toContain("after(work)");
    expect(APPLY_ROUTE_SOURCE).toContain("isLocalOrigin");
    expect(APPLY_ROUTE_SOURCE).toContain("const requestUrl = requestOrigin(req)");
    expect(APPLY_ROUTE_SOURCE).toContain("const dashboardUrl = secureRequestOrigin(req)");
    expect(APPLY_ROUTE_SOURCE).toContain("isLocalOrigin(requestUrl)");
    expect(APPLY_ROUTE_SOURCE.indexOf("secureRequestOrigin(req)")).toBeLessThan(
      APPLY_ROUTE_SOURCE.indexOf("beginBrainRuntimeApply("),
    );
    expect(APPLY_ROUTE_SOURCE).not.toContain("NEXT_PUBLIC_SERVER_URL");
    expect(APPLY_ROUTE_SOURCE).toContain("const body =");
    expect(APPLY_ROUTE_SOURCE).toContain("imageRef,");
    expect(APPLY_ROUTE_SOURCE).toContain("reset: body.reset === true");
    expect(APPLY_SERVICE_SOURCE).toContain("readBrainImage");
    expect(APPLY_SERVICE_SOURCE).toContain("input.imageRef?.trim()");
    expect(APPLY_SERVICE_SOURCE).not.toContain("runtimeView.desiredImageRef");
    expect(APPLY_SERVICE_SOURCE).toContain("imageRef,");
    expect(APPLY_SERVICE_SOURCE).toContain(
      "replaceExistingMachine: input.resetExistingMachine === true",
    );
    expect(APPLY_SERVICE_SOURCE).toContain("prepareBrainRuntimeImage");
    expect(APPLY_SERVICE_SOURCE).toContain("resolveRuntimeImageRef");
    expect(APPLY_SERVICE_SOURCE).toContain("beginBrainRuntimeApply");
    expect(APPLY_SERVICE_SOURCE).toContain(
      'service.reason === "fly_access_denied"',
    );
    expect(APPLY_SERVICE_SOURCE).toContain(
      "Fly token cannot access this Brain app.",
    );
    expect(APPLY_SERVICE_SOURCE).toContain("completeBrainRuntimeApply");
    expect(APPLY_SERVICE_SOURCE).toContain("brainImageCatalogFile");
    expect(APPLY_SERVICE_SOURCE).not.toContain("selectBrainImage");
    expect(APPLY_SERVICE_SOURCE).not.toContain("markBrainImageRunning");
    expect(WORKER_ROUTE_SOURCE).toContain("KODY_SERVICE_KEY");
    expect(WORKER_ROUTE_SOURCE).toContain("resolvePersonalBrainContextForUser");
    expect(WORKER_ROUTE_SOURCE).toContain("operationId");
    expect(WORKER_ROUTE_SOURCE).toContain("secureRequestOrigin(req)");
  });
});

import { describe, expect, it } from "vitest";

import {
  buildGuidedFlowFilePickerHref,
  addGuidedFlowFilePickerReturnHref,
  consumeGuidedFlowFileSelection,
  fileMatchesPicker,
  parseGuidedFlowFilePicker,
  storeGuidedFlowFileSelection,
} from "../../src/dashboard/lib/guided-flows/file-picker";

describe("Guided Flow file picker contract", () => {
  const picker = {
    instanceId: "instance-1",
    stepId: "step-4",
    revision: 3,
    resultField: "selectedFile",
    extensions: [".txt"],
  };

  it("adds picker state without changing the file route", () => {
    expect(buildGuidedFlowFilePickerHref("/files", picker)).toBe(
      "/files?guidedFlowPicker=1&instanceId=instance-1&stepId=step-4&revision=3&resultField=selectedFile&extensions=.txt",
    );
  });

  it("round-trips valid picker state", () => {
    const href = buildGuidedFlowFilePickerHref("/files", picker);
    expect(
      parseGuidedFlowFilePicker(
        new URL(href, "https://kody.test").searchParams,
      ),
    ).toEqual(picker);
  });

  it("carries a safe Guide return page through File Manager navigation", () => {
    const href = addGuidedFlowFilePickerReturnHref(
      buildGuidedFlowFilePickerHref("/files", picker),
      "/repo/acme/widgets/chat/conversation-1",
    );

    expect(
      parseGuidedFlowFilePicker(
        new URL(href, "https://kody.test").searchParams,
      ),
    ).toMatchObject({
      ...picker,
      returnHref: "/repo/acme/widgets/chat/conversation-1",
    });
  });

  it("rejects an external return page", () => {
    const href = `${buildGuidedFlowFilePickerHref("/files", picker)}&returnHref=https%3A%2F%2Fevil.test`;
    expect(
      parseGuidedFlowFilePicker(
        new URL(href, "https://kody.test").searchParams,
      ),
    ).toMatchObject(picker);
    expect(
      parseGuidedFlowFilePicker(
        new URL(href, "https://kody.test").searchParams,
      ),
    ).not.toHaveProperty("returnHref");
  });

  it("does not treat ordinary File Manager navigation as picker mode", () => {
    expect(parseGuidedFlowFilePicker(new URLSearchParams())).toBeNull();
  });

  it("accepts only configured file extensions", () => {
    expect(fileMatchesPicker("documents/example.txt", picker)).toBe(true);
    expect(fileMatchesPicker("documents/example.bin", picker)).toBe(false);
  });

  it("returns one matching selection to the Guide", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const selection = {
      ...picker,
      filePath: "documents/example.txt",
      fileName: "example.txt",
    };
    storeGuidedFlowFileSelection(storage, selection);

    expect(consumeGuidedFlowFileSelection(storage, picker)).toEqual(selection);
    expect(consumeGuidedFlowFileSelection(storage, picker)).toBeNull();
  });
});

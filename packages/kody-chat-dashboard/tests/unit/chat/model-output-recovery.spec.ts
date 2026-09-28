import { describe, expect, it } from "vitest";
import { isRenderedViewDirective } from "../../../src/dashboard/lib/chat-ui-actions";
import {
  buildModelOutputRecoveryView,
  isModelOutputRecoveryView,
  MODEL_OUTPUT_RECOVERY_ACTION,
} from "../../../src/dashboard/lib/chat/core/model-output-recovery";

describe("model output recovery", () => {
  it("offers only explicit user-controlled recovery choices", () => {
    const view = buildModelOutputRecoveryView({
      id: "recovery-1",
      modelLabel: "Selected model",
    });

    expect(isRenderedViewDirective(view)).toBe(true);
    expect(isModelOutputRecoveryView(view)).toBe(true);
    expect(view.data.actions).toEqual([
      expect.objectContaining({
        id: MODEL_OUTPUT_RECOVERY_ACTION.retry,
        label: "Retry same model",
      }),
      expect.objectContaining({
        id: MODEL_OUTPUT_RECOVERY_ACTION.chooseModel,
        label: "Choose another model",
      }),
      expect.objectContaining({
        id: MODEL_OUTPUT_RECOVERY_ACTION.cancel,
        label: "Cancel",
      }),
    ]);
  });
});

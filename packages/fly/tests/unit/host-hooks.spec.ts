/**
 * @fileoverview Host-injection hooks: default to null (graceful degradation)
 * and return what the host wires in.
 * @testFramework vitest
 */
import { describe, expect, it } from "vitest";

import {
  getBrainServiceResolver,
  setBrainServiceResolver,
} from "../../src/plugin/runners/brain-resolver-hook";
import {
  getTrackedBranchesReader,
  setTrackedBranchesReader,
} from "../../src/previews/tracked-branches-hook";

describe("fly host-injection hooks", () => {
  it("brain service resolver defaults to null and returns the wired resolver", () => {
    expect(getBrainServiceResolver()).toBeNull();
    const resolver = async () => {
      throw new Error("unused");
    };
    setBrainServiceResolver(resolver as never);
    expect(getBrainServiceResolver()).toBe(resolver);
  });

  it("tracked-branches reader defaults to null and returns the wired reader", () => {
    expect(getTrackedBranchesReader()).toBeNull();
    const reader = async () => ["dev"];
    setTrackedBranchesReader(reader as never);
    expect(getTrackedBranchesReader()).toBe(reader);
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  LIVE_SCHEDULE_OPTIONS,
  LIVE_SCHEDULE_VALUES,
} from "@dashboard/lib/schedule-options";

describe("live agent schedule options", () => {
  it("allows every schedule shown by the live-agent form", () => {
    const schema = z.enum(LIVE_SCHEDULE_VALUES);

    expect(schema.parse("1m")).toBe("1m");
    expect(LIVE_SCHEDULE_OPTIONS.map((option) => option.value)).toEqual(
      LIVE_SCHEDULE_VALUES,
    );
  });
});

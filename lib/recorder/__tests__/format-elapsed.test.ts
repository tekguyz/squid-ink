import { describe, expect, it } from "vitest";
import { formatElapsed } from "@/lib/recorder/format-elapsed";

describe("formatElapsed", () => {
  it("renders zero as 0:00", () => {
    expect(formatElapsed(0)).toBe("0:00");
  });

  it("pads seconds but not the leading minute", () => {
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(61_000)).toBe("1:01");
  });

  it("matches the design's 12:41 shape", () => {
    expect(formatElapsed(12 * 60_000 + 41_000)).toBe("12:41");
  });

  it("grows an hours field past 60 minutes, zero-padding minutes", () => {
    expect(formatElapsed(3_723_000)).toBe("1:02:03");
  });

  it("truncates rather than rounds, so the clock never shows a second early", () => {
    expect(formatElapsed(1_999)).toBe("0:01");
  });

  it("treats negative input as zero rather than rendering a minus sign", () => {
    expect(formatElapsed(-5_000)).toBe("0:00");
  });
});

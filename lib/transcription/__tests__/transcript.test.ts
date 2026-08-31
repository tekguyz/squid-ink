// @vitest-environment node
import { describe, it, expect } from "vitest";
import { speakerFor, formatTimestamp } from "@/lib/transcription/transcript";

describe("speakerFor", () => {
  it("maps Gemini's spk_1 onto the first speaker token", () => {
    expect(speakerFor("spk_1")).toEqual({
      name: "Speaker 1",
      initials: "S1",
      token: "speaker-1",
    });
  });

  it("maps spk_2 and spk_3 onto the remaining tokens", () => {
    expect(speakerFor("spk_2")?.token).toBe("speaker-2");
    expect(speakerFor("spk_3")?.token).toBe("speaker-3");
  });

  it("cycles past the third token but keeps the real speaker number", () => {
    // Only three colour tokens exist in globals.css and Tailwind cannot build
    // a class name at runtime, so a fourth speaker must reuse a colour. The
    // NAME must still say 4 — colour collision is cosmetic, a wrong name is a
    // lie about who spoke.
    expect(speakerFor("spk_4")).toEqual({
      name: "Speaker 4",
      initials: "S4",
      token: "speaker-1",
    });
    expect(speakerFor("spk_8")?.token).toBe("speaker-2");
    expect(speakerFor("spk_8")?.name).toBe("Speaker 8");
  });

  it("returns null for a missing label, not a fabricated speaker", () => {
    expect(speakerFor(null)).toBeNull();
  });

  it("returns null for a label with no number in it", () => {
    expect(speakerFor("unknown")).toBeNull();
  });
});

describe("formatTimestamp", () => {
  it("renders mm:ss with a leading zero", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(9)).toBe("00:09");
    expect(formatTimestamp(75)).toBe("01:15");
  });

  it("truncates fractional seconds rather than rounding up past the minute", () => {
    expect(formatTimestamp(59.9)).toBe("00:59");
  });

  it("grows an hour field only once there is an hour", () => {
    expect(formatTimestamp(3599)).toBe("59:59");
    expect(formatTimestamp(3600)).toBe("1:00:00");
    expect(formatTimestamp(3661)).toBe("1:01:01");
  });

  it("clamps a negative offset to zero", () => {
    expect(formatTimestamp(-1)).toBe("00:00");
  });
});

// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  speakerFor,
  speakerOrdinals,
  formatTimestamp,
  type TranscriptSegment,
} from "@/lib/transcription/transcript";

function seg(speakerLabel: string | null): TranscriptSegment {
  return { speakerLabel, startSeconds: 0, endSeconds: 1, text: "x" };
}

describe("speakerOrdinals", () => {
  it("numbers speakers by first appearance, ignoring the label's own digits", () => {
    // MEASURED against the live API on 2026-08-31: Gemini returned "spk:7" for
    // the ONLY speaker in a single-voice recording. The label is an opaque
    // cluster id — colon, not underscore, and the number is not an index.
    // Reading 7 out of it and printing "Speaker 7" would be a lie about a
    // one-person recording.
    const ordinals = speakerOrdinals([seg("spk:7"), seg("spk:3"), seg("spk:7")]);

    expect(ordinals.get("spk:7")).toBe(1);
    expect(ordinals.get("spk:3")).toBe(2);
    expect(ordinals.size).toBe(2);
  });

  it("handles the documented spk_1 form the same way", () => {
    const ordinals = speakerOrdinals([seg("spk_1"), seg("spk_2")]);
    expect(ordinals.get("spk_1")).toBe(1);
    expect(ordinals.get("spk_2")).toBe(2);
  });

  it("ignores unlabelled segments entirely", () => {
    expect(speakerOrdinals([seg(null), seg(null)]).size).toBe(0);
  });

  it("returns an empty map for no segments", () => {
    expect(speakerOrdinals([]).size).toBe(0);
  });
});

describe("speakerFor", () => {
  it("maps the first speaker onto the first token", () => {
    expect(speakerFor(1)).toEqual({
      name: "Speaker 1",
      initials: "S1",
      token: "speaker-1",
    });
  });

  it("maps the second and third onto the remaining tokens", () => {
    expect(speakerFor(2)?.token).toBe("speaker-2");
    expect(speakerFor(3)?.token).toBe("speaker-3");
  });

  it("cycles past the third token but keeps the real speaker number", () => {
    // Only three colour tokens exist in globals.css and Tailwind cannot build
    // a class name at runtime, so a fourth speaker must reuse a colour. The
    // NAME must still say 4 — colour collision is cosmetic, a wrong name is a
    // lie about who spoke.
    expect(speakerFor(4)).toEqual({
      name: "Speaker 4",
      initials: "S4",
      token: "speaker-1",
    });
    expect(speakerFor(8)?.token).toBe("speaker-2");
    expect(speakerFor(8)?.name).toBe("Speaker 8");
  });

  it("returns null for a missing ordinal, not a fabricated speaker", () => {
    expect(speakerFor(null)).toBeNull();
    expect(speakerFor(undefined)).toBeNull();
  });

  it("returns null for a zero or negative ordinal", () => {
    expect(speakerFor(0)).toBeNull();
    expect(speakerFor(-1)).toBeNull();
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

import { describe, expect, it, vi } from "vitest";
import { CODEC_CANDIDATES, pickMimeType } from "@/lib/recorder/codec";

const only =
  (...supported: string[]) =>
  (type: string) =>
    supported.includes(type);

describe("pickMimeType", () => {
  it("prefers Opus in WebM when Chromium offers it", () => {
    expect(pickMimeType(only("audio/webm;codecs=opus", "audio/webm"))).toBe(
      "audio/webm;codecs=opus",
    );
  });

  it("falls back to bare WebM when the codec-qualified string is refused", () => {
    expect(pickMimeType(only("audio/webm"))).toBe("audio/webm");
  });

  it("picks AAC in MP4 for Safari, which supports no WebM at all", () => {
    expect(pickMimeType(only("audio/mp4;codecs=mp4a.40.2", "audio/mp4"))).toBe(
      "audio/mp4;codecs=mp4a.40.2",
    );
  });

  it("falls back to bare MP4 when Safari refuses the codec-qualified string", () => {
    expect(pickMimeType(only("audio/mp4"))).toBe("audio/mp4");
  });

  it("returns null rather than guessing when nothing is supported", () => {
    expect(pickMimeType(() => false)).toBeNull();
  });

  it("asks about every candidate in order and stops at the first yes", () => {
    const isSupported = vi.fn((t: string) => t === "audio/webm");
    pickMimeType(isSupported);
    expect(isSupported.mock.calls.map(([t]) => t)).toEqual([
      "audio/webm;codecs=opus",
      "audio/webm",
    ]);
  });

  it("lists WebM before MP4 so Chromium never lands on the Safari string", () => {
    const webm = CODEC_CANDIDATES.findIndex((c) => c.startsWith("audio/webm"));
    const mp4 = CODEC_CANDIDATES.findIndex((c) => c.startsWith("audio/mp4"));
    expect(webm).toBeGreaterThanOrEqual(0);
    expect(mp4).toBeGreaterThan(webm);
  });

  it("never hardcodes a single string", () => {
    expect(CODEC_CANDIDATES.length).toBeGreaterThan(1);
  });
});

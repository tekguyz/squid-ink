// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  segmentsFromInteraction,
  parseOffsetSeconds,
  resolveAudioMimeType,
} from "@/lib/transcription/gemini-client";

/** Shaped exactly like the documented response:
 *  ai.google.dev/gemini-api/docs/transcribe, § speaker diarization. */
function interaction(
  words: { text: string; speaker?: string; from: string; to: string }[],
) {
  return {
    output_text: words.map((w) => w.text).join(" "),
    steps: [
      {
        content: [
          {
            annotations: words.map((w) => ({
              type: "word_info",
              text: w.text,
              speaker: w.speaker,
              start_offset: w.from,
              end_offset: w.to,
            })),
          },
        ],
      },
    ],
  };
}

describe("resolveAudioMimeType", () => {
  it("skips application/octet-stream in favour of a real audio type", () => {
    // MEASURED 2026-08-31: Storage's download() returned a Blob typed
    // application/octet-stream, and Gemini answered
    // "400 Unsupported MIME type: application/octet-stream". The object's own
    // list() metadata had the real type all along.
    expect(resolveAudioMimeType(["application/octet-stream", "audio/wav"])).toBe(
      "audio/wav",
    );
  });

  it("strips codec parameters, which the API rejects", () => {
    expect(resolveAudioMimeType(["audio/webm;codecs=opus"])).toBe("audio/webm");
  });

  it("accepts video/webm — MediaRecorder labels container audio that way", () => {
    expect(resolveAudioMimeType(["video/webm"])).toBe("video/webm");
  });

  it("falls back to audio/webm when every candidate is useless", () => {
    expect(resolveAudioMimeType([null, undefined, "", "application/octet-stream"])).toBe(
      "audio/webm",
    );
  });

  it("lowercases and trims", () => {
    expect(resolveAudioMimeType(["  AUDIO/WAV  "])).toBe("audio/wav");
  });
});

describe("parseOffsetSeconds", () => {
  it("strips the trailing s", () => {
    expect(parseOffsetSeconds("0.450s")).toBe(0.45);
    expect(parseOffsetSeconds("12s")).toBe(12);
  });

  it("accepts a bare number", () => {
    expect(parseOffsetSeconds("3.5")).toBe(3.5);
  });

  it("returns null rather than NaN for junk or absence", () => {
    expect(parseOffsetSeconds(undefined)).toBeNull();
    expect(parseOffsetSeconds("")).toBeNull();
    expect(parseOffsetSeconds("later")).toBeNull();
  });
});

describe("segmentsFromInteraction", () => {
  it("groups consecutive words by speaker into one segment", () => {
    const segments = segmentsFromInteraction(
      interaction([
        { text: "Hello", speaker: "spk_1", from: "0s", to: "0.5s" },
        { text: "there", speaker: "spk_1", from: "0.5s", to: "1s" },
        { text: "Hi", speaker: "spk_2", from: "1.2s", to: "1.6s" },
      ]),
    );

    expect(segments).toEqual([
      { speakerLabel: "spk_1", startSeconds: 0, endSeconds: 1, text: "Hello there" },
      { speakerLabel: "spk_2", startSeconds: 1.2, endSeconds: 1.6, text: "Hi" },
    ]);
  });

  it("starts a new segment when the same speaker returns", () => {
    const segments = segmentsFromInteraction(
      interaction([
        { text: "A", speaker: "spk_1", from: "0s", to: "1s" },
        { text: "B", speaker: "spk_2", from: "1s", to: "2s" },
        { text: "C", speaker: "spk_1", from: "2s", to: "3s" },
      ]),
    );

    expect(segments.map((s) => s.text)).toEqual(["A", "B", "C"]);
    expect(segments.map((s) => s.speakerLabel)).toEqual([
      "spk_1",
      "spk_2",
      "spk_1",
    ]);
  });

  it("keeps one segment when nothing is diarized", () => {
    const segments = segmentsFromInteraction(
      interaction([
        { text: "One", from: "0s", to: "1s" },
        { text: "two", from: "1s", to: "2s" },
      ]),
    );

    expect(segments).toEqual([
      { speakerLabel: null, startSeconds: 0, endSeconds: 2, text: "One two" },
    ]);
  });

  it("breaks a long monologue at a pause", () => {
    // Without this, one speaker talking for twenty minutes is ONE chunk of a
    // few thousand words — useless to render and useless to retrieve. A gap
    // between words is the cheapest honest sentence boundary available; we do
    // not get punctuation offsets.
    const segments = segmentsFromInteraction(
      interaction([
        { text: "One", speaker: "spk_1", from: "0s", to: "1s" },
        { text: "two", speaker: "spk_1", from: "1.1s", to: "2s" },
        { text: "Three", speaker: "spk_1", from: "9s", to: "10s" },
      ]),
    );

    expect(segments.map((s) => s.text)).toEqual(["One two", "Three"]);
    expect(segments[1].startSeconds).toBe(9);
  });

  it("does not break on a pause shorter than the threshold", () => {
    const segments = segmentsFromInteraction(
      interaction([
        { text: "One", speaker: "spk_1", from: "0s", to: "1s" },
        { text: "two", speaker: "spk_1", from: "2.4s", to: "3s" },
      ]),
    );

    expect(segments).toHaveLength(1);
  });

  it("returns no segments when there are no annotations at all", () => {
    expect(
      segmentsFromInteraction({ output_text: "Some text", steps: [] }),
    ).toEqual([]);
  });

  it("survives a response with missing steps, content or annotations", () => {
    expect(segmentsFromInteraction({ output_text: "x" })).toEqual([]);
    expect(segmentsFromInteraction({ output_text: "x", steps: [{}] })).toEqual(
      [],
    );
    expect(
      segmentsFromInteraction({ output_text: "x", steps: [{ content: [{}] }] }),
    ).toEqual([]);
  });

  it("skips a word with an unreadable offset rather than emitting NaN", () => {
    const segments = segmentsFromInteraction({
      output_text: "good bad",
      steps: [
        {
          content: [
            {
              annotations: [
                {
                  type: "word_info",
                  text: "good",
                  speaker: "spk_1",
                  start_offset: "0s",
                  end_offset: "1s",
                },
                { type: "word_info", text: "bad", speaker: "spk_1" },
              ],
            },
          ],
        },
      ],
    });

    expect(segments).toEqual([
      { speakerLabel: "spk_1", startSeconds: 0, endSeconds: 1, text: "good" },
    ]);
  });

  it("ignores annotations that are not word_info", () => {
    const segments = segmentsFromInteraction({
      output_text: "x",
      steps: [
        {
          content: [
            {
              annotations: [
                { type: "something_else", text: "ignore me" },
                {
                  type: "word_info",
                  text: "keep",
                  start_offset: "0s",
                  end_offset: "1s",
                },
              ],
            },
          ],
        },
      ],
    });

    expect(segments.map((s) => s.text)).toEqual(["keep"]);
  });
});

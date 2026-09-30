import { describe, expect, it } from "vitest";
import { isNoteWriting, isPipelineDone } from "@/lib/notes/notegen-progress";

describe("isNoteWriting", () => {
  it("counts null generation on a completed transcription as not done", () => {
    expect(isNoteWriting("completed", null)).toBe(true);
  });

  it("is true while generating", () => {
    expect(isNoteWriting("completed", "generating")).toBe(true);
  });

  it("is false once generation is terminal", () => {
    expect(isNoteWriting("completed", "completed")).toBe(false);
    expect(isNoteWriting("completed", "failed")).toBe(false);
  });

  it("is false while transcription itself is unfinished or failed", () => {
    expect(isNoteWriting("analyzing", null)).toBe(false);
    expect(isNoteWriting("failed", null)).toBe(false);
  });
});

describe("isPipelineDone", () => {
  it("needs a terminal generation after a completed transcription", () => {
    expect(isPipelineDone("completed", null)).toBe(false);
    expect(isPipelineDone("completed", "generating")).toBe(false);
    expect(isPipelineDone("completed", "completed")).toBe(true);
    expect(isPipelineDone("completed", "failed")).toBe(true);
  });

  it("is done on a failed transcription, where generation never runs", () => {
    expect(isPipelineDone("failed", null)).toBe(true);
  });

  it("is not done while transcription is still running", () => {
    expect(isPipelineDone("analyzing", null)).toBe(false);
    expect(isPipelineDone("uploading", null)).toBe(false);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { useRecorderStore } from "@/lib/recorder/recorder-store";

const state = () => useRecorderStore.getState();
const NOTE = "11111111-2222-3333-4444-555555555555";

/** Drive the store to a live recording, the starting point for most cases. */
function toRecording() {
  state().requestStart(NOTE);
  state().confirmStart("audio/webm;codecs=opus");
}

describe("recorder store", () => {
  beforeEach(() => {
    state().discard();
  });

  it("starts idle with nothing held", () => {
    expect(state().phase).toBe("idle");
    expect(state().noteId).toBeNull();
    expect(state().elapsedMs).toBe(0);
    expect(state().level).toBe(0);
    expect(state().mimeType).toBeNull();
    expect(state().errorMessage).toBeNull();
  });

  it("holds the note id from the moment permission is requested", () => {
    state().requestStart(NOTE);
    expect(state().phase).toBe("requesting");
    expect(state().noteId).toBe(NOTE);
  });

  it("records the negotiated mime type when capture confirms", () => {
    toRecording();
    expect(state().phase).toBe("recording");
    expect(state().mimeType).toBe("audio/webm;codecs=opus");
  });

  it("accrues elapsed time only while recording", () => {
    toRecording();
    state().tick(1000);
    expect(state().elapsedMs).toBe(1000);

    state().pause();
    state().tick(5000);
    expect(state().elapsedMs).toBe(1000);

    state().resume();
    state().tick(500);
    expect(state().elapsedMs).toBe(1500);
  });

  it("clamps the level to 0..1", () => {
    toRecording();
    state().setLevel(2.5);
    expect(state().level).toBe(1);
    state().setLevel(-3);
    expect(state().level).toBe(0);
  });

  it("walks stop -> upload -> finish back to a clean idle", () => {
    toRecording();
    state().tick(1000);
    state().beginStop();
    expect(state().phase).toBe("stopping");
    state().beginUpload();
    expect(state().phase).toBe("uploading");
    state().finish();
    expect(state().phase).toBe("idle");
    expect(state().noteId).toBeNull();
    expect(state().elapsedMs).toBe(0);
  });

  it("keeps the note id after a failure so a retry reuses the same object path", () => {
    toRecording();
    state().beginStop();
    state().beginUpload();
    state().fail("network died");
    expect(state().phase).toBe("error");
    expect(state().noteId).toBe(NOTE);
    expect(state().errorMessage).toBe("network died");
  });

  it("lets a failed upload be retried without a new note id", () => {
    toRecording();
    state().beginStop();
    state().beginUpload();
    state().fail("network died");
    state().beginUpload();
    expect(state().phase).toBe("uploading");
    expect(state().noteId).toBe(NOTE);
    expect(state().errorMessage).toBeNull();
  });

  it("discards everything from any phase", () => {
    toRecording();
    state().tick(9000);
    state().setLevel(0.8);
    state().discard();
    expect(state().phase).toBe("idle");
    expect(state().noteId).toBeNull();
    expect(state().elapsedMs).toBe(0);
    expect(state().level).toBe(0);
    expect(state().mimeType).toBeNull();
  });

  it("ignores illegal transitions instead of throwing", () => {
    expect(() => state().pause()).not.toThrow();
    expect(state().phase).toBe("idle");

    expect(() => state().confirmStart("audio/webm")).not.toThrow();
    expect(state().phase).toBe("idle");

    toRecording();
    expect(() => state().resume()).not.toThrow();
    expect(state().phase).toBe("recording");

    expect(() => state().finish()).not.toThrow();
    expect(state().phase).toBe("recording");
  });

  it("refuses a second start while a recording is live", () => {
    toRecording();
    state().requestStart("99999999-9999-9999-9999-999999999999");
    expect(state().phase).toBe("recording");
    expect(state().noteId).toBe(NOTE);
  });

  it("can start again from the error phase", () => {
    toRecording();
    state().fail("boom");
    state().requestStart("99999999-9999-9999-9999-999999999999");
    expect(state().phase).toBe("requesting");
    expect(state().noteId).toBe("99999999-9999-9999-9999-999999999999");
    expect(state().errorMessage).toBeNull();
  });

  it("is one module-level store, so importing it twice is the same state", async () => {
    toRecording();
    const again = await import("@/lib/recorder/recorder-store");
    expect(again.useRecorderStore.getState().phase).toBe("recording");
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { useRecorderStore } from "@/lib/recorder/recorder-store";

const state = () => useRecorderStore.getState();
const NOTE = "11111111-2222-3333-4444-555555555555";

/** Drive the store to a live recording, the starting point for most cases. */
function toRecording() {
  state().requestStart(NOTE, "meeting");
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
    expect(state().errorCause).toBeNull();
  });

  it("holds the note id from the moment permission is requested", () => {
    state().requestStart(NOTE, "meeting");
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

  it("walks stop -> upload -> saved, holding the note id and the frozen length", () => {
    toRecording();
    state().tick(1000);
    state().beginStop();
    expect(state().phase).toBe("stopping");
    state().beginUpload();
    expect(state().phase).toBe("uploading");
    state().finish();
    expect(state().phase).toBe("saved");
    expect(state().noteId).toBe(NOTE);
    expect(state().elapsedMs).toBe(1000);
    expect(state().micLost).toBe(false);
  });

  it("carries micLost from the stop to the saved result", () => {
    toRecording();
    state().beginStop(true);
    state().beginUpload();
    state().finish();
    expect(state().phase).toBe("saved");
    expect(state().micLost).toBe(true);
  });

  it("closes the saved state back to a clean idle", () => {
    toRecording();
    state().beginStop();
    state().beginUpload();
    state().finish();
    state().closeSaved();
    expect(state().phase).toBe("idle");
    expect(state().noteId).toBeNull();
    expect(state().elapsedMs).toBe(0);
  });

  it("starts a new recording straight from saved, as from idle", () => {
    toRecording();
    state().beginStop();
    state().beginUpload();
    state().finish();
    state().openChoice();
    expect(state().phase).toBe("choosing");
    expect(state().noteId).toBeNull();
  });

  it("keeps the note id after a failed save so a retry reuses the same object path", () => {
    toRecording();
    state().beginStop();
    state().beginUpload();
    state().fail("save-failed");
    expect(state().phase).toBe("error");
    expect(state().noteId).toBe(NOTE);
    expect(state().errorCause).toBe("save-failed");
  });

  it("re-enters Saving from a failed save, and only from a failed save", () => {
    toRecording();
    state().beginStop();
    state().beginUpload();
    state().fail("save-failed");
    state().beginRetry();
    expect(state().phase).toBe("uploading");
    expect(state().noteId).toBe(NOTE);
    expect(state().errorCause).toBeNull();

    state().discard();
    state().requestStart(NOTE, "mic");
    state().fail("mic-refused");
    state().beginRetry();
    expect(state().phase).toBe("error");
  });

  // Only a failed save has audio behind it. Every other cause must not carry a
  // note id, because the HUD reads one as "kept on this device".
  it("drops the note id for every cause but a failed save", () => {
    toRecording();
    state().fail("start-failed");
    expect(state().noteId).toBeNull();
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
    state().requestStart("99999999-9999-9999-9999-999999999999", "mic");
    expect(state().phase).toBe("recording");
    expect(state().noteId).toBe(NOTE);
  });

  it("can start again from the error phase", () => {
    toRecording();
    state().fail("start-failed");
    state().requestStart("99999999-9999-9999-9999-999999999999", "mic");
    expect(state().phase).toBe("requesting");
    expect(state().noteId).toBe("99999999-9999-9999-9999-999999999999");
    expect(state().errorCause).toBeNull();
  });

  it("opens the mode choice from idle and closes it back to idle", () => {
    state().openChoice();
    expect(state().phase).toBe("choosing");
    state().closeChoice();
    expect(state().phase).toBe("idle");
  });

  it("opens the choice from the error phase, clearing the error", () => {
    toRecording();
    state().fail("start-failed");
    state().openChoice();
    expect(state().phase).toBe("choosing");
    expect(state().errorCause).toBeNull();
  });

  it("does not open the choice while a recording is live", () => {
    toRecording();
    state().openChoice();
    expect(state().phase).toBe("recording");
  });

  it("starts from the choice and holds the chosen mode", () => {
    state().openChoice();
    state().requestStart(NOTE, "mic");
    expect(state().phase).toBe("requesting");
    expect(state().mode).toBe("mic");
  });

  it("goes back to the choice from requesting, with or without a notice", () => {
    state().openChoice();
    state().requestStart(NOTE, "meeting");
    state().backToChoice("No sound was shared.");
    expect(state().phase).toBe("choosing");
    expect(state().notice).toBe("No sound was shared.");
    expect(state().noteId).toBeNull();

    state().requestStart(NOTE, "meeting");
    expect(state().notice).toBeNull();
    state().backToChoice(null);
    expect(state().notice).toBeNull();
  });

  it("ignores backToChoice outside requesting", () => {
    toRecording();
    state().backToChoice(null);
    expect(state().phase).toBe("recording");
  });

  // A prompt refused before any audio exists: there is nothing kept on this
  // device, so the error must not carry a note id that says there is.
  it("drops the note id when it fails before recording began", () => {
    state().requestStart(NOTE, "mic");
    state().fail("mic-refused");
    expect(state().phase).toBe("error");
    expect(state().noteId).toBeNull();
  });

  it("is one module-level store, so importing it twice is the same state", async () => {
    toRecording();
    const again = await import("@/lib/recorder/recorder-store");
    expect(again.useRecorderStore.getState().phase).toBe("recording");
  });
});

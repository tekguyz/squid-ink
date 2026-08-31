import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordHud } from "@/components/recorder/record-hud";
import { useRecorderStore } from "@/lib/recorder/recorder-store";

const NOTE = "11111111-2222-3333-4444-555555555555";

const controls = () => ({
  start: vi.fn(async () => {}),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(async () => {}),
  discard: vi.fn(async () => {}),
});

const state = () => useRecorderStore.getState();

function toRecording() {
  state().requestStart(NOTE);
  state().confirmStart("audio/webm;codecs=opus");
}

describe("RecordHud", () => {
  beforeEach(() => state().discard());

  it("offers Record with the shortcut when idle", () => {
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument();
    expect(screen.getByText("⌘⇧R")).toBeInTheDocument();
  });

  it("starts capture when Record is pressed", async () => {
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    expect(c.start).toHaveBeenCalled();
  });

  it("shows the elapsed clock, Pause and Stop while recording", () => {
    toRecording();
    state().tick(12 * 60_000 + 41_000);
    render(<RecordHud controls={controls()} />);
    expect(screen.getByText("12:41")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /record/i })).not.toBeInTheDocument();
  });

  it("announces that it is capturing system audio and mic", () => {
    toRecording();
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/recording/i);
  });

  it("pauses through the controls", async () => {
    toRecording();
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(c.pause).toHaveBeenCalled();
  });

  it("offers Resume and Discard when paused, and keeps the clock", () => {
    toRecording();
    state().tick(61_000);
    state().pause();
    render(<RecordHud controls={controls()} />);
    expect(screen.getByText("1:01")).toBeInTheDocument();
    expect(screen.getByText(/^Paused$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard/i })).toBeInTheDocument();
  });

  it("resumes and discards through the controls", async () => {
    toRecording();
    state().pause();
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /resume/i }));
    expect(c.resume).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(c.discard).toHaveBeenCalled();
  });

  it("shows an uploading state with no controls to press", () => {
    toRecording();
    state().beginStop();
    state().beginUpload();
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/uploading/i);
    expect(screen.queryByRole("button", { name: /stop/i })).not.toBeInTheDocument();
  });

  it("surfaces the error message", () => {
    toRecording();
    state().fail("Audio upload failed: offline");
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/offline/);
  });

  // Scope fence: the brief asks that a failed upload be VISIBLE, not that it be
  // recoverable in one click. A retry button would be a feature nobody asked
  // for, and there is no retry control on the hook to wire it to.
  it("offers no retry — only a dismiss", () => {
    toRecording();
    state().fail("Audio upload failed: offline");
    render(<RecordHud controls={controls()} />);
    expect(
      screen.queryByRole("button", { name: /try again|retry/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("says the recording is kept, because the audio really is still on disk", () => {
    toRecording();
    state().fail("Audio upload failed: offline");
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/kept on this device/i);
  });

  it("starts recording on the ⌘⇧R / Ctrl+Shift+R shortcut", async () => {
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.keyboard("{Control>}{Shift>}R{/Shift}{/Control}");
    expect(c.start).toHaveBeenCalled();
  });

  it("ignores the shortcut while a recording is already running", async () => {
    toRecording();
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.keyboard("{Control>}{Shift>}R{/Shift}{/Control}");
    expect(c.start).not.toHaveBeenCalled();
  });

  it("renders the design's drag caption while recording", () => {
    toRecording();
    render(<RecordHud controls={controls()} />);
    expect(screen.getByText(/SNAPS TO THE NEAREST CORNER/)).toBeInTheDocument();
  });
});

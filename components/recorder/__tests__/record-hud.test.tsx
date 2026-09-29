import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordHud } from "@/components/recorder/record-hud";
import { useRecorderStore } from "@/lib/recorder/recorder-store";

const NOTE = "11111111-2222-3333-4444-555555555555";

const controls = () => ({
  start: vi.fn(async () => {}),
  choose: vi.fn(async (_mode: "meeting" | "mic") => {}),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(async () => {}),
  retry: vi.fn(async () => {}),
  discard: vi.fn(async () => {}),
});

const state = () => useRecorderStore.getState();

function toRecording(mode: "meeting" | "mic" = "meeting") {
  state().requestStart(NOTE, mode);
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

  it("announces a Meeting as shared sound and mic", () => {
    toRecording("meeting");
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /recording shared sound and microphone/i,
    );
  });

  it("announces Mic only as the microphone alone", () => {
    toRecording("mic");
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/recording microphone/i);
    expect(screen.getByRole("status")).not.toHaveTextContent(/shared/i);
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
    await userEvent.click(screen.getByRole("button", { name: /confirm discard/i }));
    expect(c.discard).toHaveBeenCalled();
  });

  // The waiting, Saving, Saved and error pills: record-hud-states.test.tsx.

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

  it("does not promise drag or snap while recording, because the HUD has neither", () => {
    toRecording();
    render(<RecordHud controls={controls()} />);
    expect(screen.queryByText(/SNAPS TO THE NEAREST CORNER/)).not.toBeInTheDocument();
  });
});

/** Issue #19: a demo visitor sees Record, turned off and saying why. Hiding it
 *  would hide that the app records at all. */
describe("RecordHud in the demo", () => {
  beforeEach(() => state().discard());

  it("shows Record turned off with the demo message, still reachable by Tab", async () => {
    const c = controls();
    render(<RecordHud controls={c} demo />);
    const record = screen.getByRole("button", { name: /record/i });
    expect(record).toHaveAttribute("aria-disabled", "true");
    expect(record).toHaveAccessibleDescription("Not available in the demo.");
    await userEvent.tab();
    expect(record).toHaveFocus();
    await userEvent.click(record);
    expect(c.start).not.toHaveBeenCalled();
  });

  it("ignores the shortcut", async () => {
    const c = controls();
    render(<RecordHud controls={c} demo />);
    await userEvent.keyboard("{Control>}{Shift>}R{/Shift}{/Control}");
    expect(c.start).not.toHaveBeenCalled();
  });

  it("is unchanged outside the demo", async () => {
    const c = controls();
    render(<RecordHud controls={c} demo={false} />);
    const record = screen.getByRole("button", { name: /record/i });
    expect(record).toBeEnabled();
    expect(screen.queryByText("Not available in the demo.")).toBeNull();
    await userEvent.click(record);
    expect(c.start).toHaveBeenCalled();
  });
});

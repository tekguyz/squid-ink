import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordHud } from "@/components/recorder/record-hud";
import { useRecorderStore } from "@/lib/recorder/recorder-store";
import { MIC_REFUSED, MODE_DESCRIPTION, NO_SOUND_SHARED } from "@/lib/recorder/recording-mode";

/** #20: the Meeting / Mic only choice and the two-step destructive controls.
 *  Split from record-hud.test.tsx, which covers the phases as they were. */

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

function toRecording() {
  state().requestStart(NOTE, "meeting");
  state().confirmStart("audio/webm;codecs=opus");
}

/** The fake start() does what the hook does on a device that can share
 *  sound, so the HUD is driven the way a user drives it. */
const choosingControls = () => ({
  ...controls(),
  start: vi.fn(async () => state().openChoice()),
});

describe("RecordHud — the mode choice", () => {
  beforeEach(() => state().discard());

  it("opens the choice on Record, with focus on the first option", async () => {
    render(<RecordHud controls={choosingControls()} />);
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    expect(screen.getByRole("group", { name: /record/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^meeting$/i })).toHaveFocus();
    expect(screen.getByRole("button", { name: /^mic only$/i })).toBeInTheDocument();
  });

  it("opens the same choice on ⌘⇧R", async () => {
    render(<RecordHud controls={choosingControls()} />);
    await userEvent.keyboard("{Control>}{Shift>}R{/Shift}{/Control}");
    expect(screen.getByRole("button", { name: /^mic only$/i })).toBeInTheDocument();
  });

  it("describes what each mode records", async () => {
    render(<RecordHud controls={choosingControls()} />);
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    expect(screen.getByRole("button", { name: /^meeting$/i })).toHaveAccessibleDescription(
      MODE_DESCRIPTION.meeting,
    );
    expect(screen.getByRole("button", { name: /^mic only$/i })).toHaveAccessibleDescription(
      MODE_DESCRIPTION.mic,
    );
  });

  // Critique: the meaning lived only in screen-reader text. A sighted user in
  // an in-person meeting would pick Meeting.
  it("shows what the focused or hovered mode records", async () => {
    render(<RecordHud controls={choosingControls()} />);
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    expect(screen.getByText("Tab sound + your mic", { ignore: ".sr-only" })).toBeVisible();
    await userEvent.hover(screen.getByRole("button", { name: /^mic only$/i }));
    // Both captions sit in one grid cell; the pointed one is the one drawn.
    expect(screen.getByText("Your mic alone", { ignore: ".sr-only" })).not.toHaveClass("invisible");
    expect(screen.getByText("Tab sound + your mic", { ignore: ".sr-only" })).toHaveClass("invisible");
  });

  it("moves focus to Dismiss when the start fails, and back to Record after", async () => {
    const c = {
      ...controls(),
      choose: vi.fn(async () => {
        state().requestStart(NOTE, "mic");
        state().fail("mic-refused");
      }),
    };
    render(<RecordHud controls={{ ...c, start: vi.fn(async () => state().openChoice()) }} />);
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    await userEvent.click(screen.getByRole("button", { name: /^mic only$/i }));
    const dismiss = screen.getByRole("button", { name: /^dismiss$/i });
    expect(dismiss).toHaveFocus();
    c.discard.mockImplementation(async () => state().discard());
    await userEvent.click(dismiss);
    expect(screen.getByRole("button", { name: /record/i })).toHaveFocus();
  });

  it("shows no choice on a device that cannot share sound", async () => {
    const c = { ...controls(), start: vi.fn(async () => state().requestStart(NOTE, "mic")) };
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    expect(screen.queryByRole("group", { name: /record/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /meeting/i })).toBeNull();
  });

  it("records the mode picked", async () => {
    const c = choosingControls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    await userEvent.click(screen.getByRole("button", { name: /^mic only$/i }));
    expect(c.choose).toHaveBeenCalledWith("mic");
  });

  it("closes on Escape and hands focus back to Record", async () => {
    render(<RecordHud controls={choosingControls()} />);
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    await userEvent.keyboard("{Escape}");
    expect(state().phase).toBe("idle");
    expect(screen.getByRole("button", { name: /record/i })).toHaveFocus();
  });

  it("closes on Escape with focus outside the choice", async () => {
    render(<RecordHud controls={choosingControls()} />);
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    (document.activeElement as HTMLElement).blur();
    await userEvent.keyboard("{Escape}");
    expect(state().phase).toBe("idle");
  });

  it("closes on Cancel", async () => {
    render(<RecordHud controls={choosingControls()} />);
    await userEvent.click(screen.getByRole("button", { name: /record/i }));
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(state().phase).toBe("idle");
  });

  it("says plainly when no sound was shared, with no error", () => {
    state().openChoice();
    state().requestStart(NOTE, "meeting");
    state().backToChoice(NO_SOUND_SHARED);
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("status")).toHaveTextContent(NO_SOUND_SHARED);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /^mic only$/i })).toBeInTheDocument();
  });
});

describe("RecordHud — two-step controls", () => {
  beforeEach(() => state().discard());

  it("Stop arms on the first press and stops on the second", async () => {
    toRecording();
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    expect(c.stop).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^confirm stop$/i }));
    expect(c.stop).toHaveBeenCalledTimes(1);
  });

  it("Escape disarms Stop", async () => {
    toRecording();
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    expect(c.stop).not.toHaveBeenCalled();
  });

  it("moving focus away disarms Stop", async () => {
    toRecording();
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    await userEvent.tab();
    expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument();
    expect(c.stop).not.toHaveBeenCalled();
  });

  it("another HUD action disarms Stop", async () => {
    toRecording();
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    await userEvent.click(screen.getByRole("button", { name: /pause/i }));
    expect(c.pause).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument();
  });

  it("a phase change disarms", async () => {
    toRecording();
    render(<RecordHud controls={controls()} />);
    await userEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    act(() => state().pause());
    act(() => state().resume());
    expect(screen.getByRole("button", { name: /^stop$/i })).toBeInTheDocument();
  });

  it("Discard needs two presses", async () => {
    toRecording();
    state().pause();
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(c.discard).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^confirm discard$/i }));
    expect(c.discard).toHaveBeenCalledTimes(1);
  });

  it("Dismiss needs two presses when it would delete kept audio, and says so", async () => {
    toRecording();
    state().fail("save-failed");
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /^dismiss$/i }));
    expect(c.discard).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/second press deletes it/i);
    await userEvent.click(screen.getByRole("button", { name: /^confirm dismiss$/i }));
    expect(c.discard).toHaveBeenCalledTimes(1);
  });

  it("Dismiss is one press when no audio exists, and claims nothing is kept", async () => {
    state().requestStart(NOTE, "mic");
    state().fail("mic-refused");
    const c = controls();
    render(<RecordHud controls={c} />);
    expect(screen.getByRole("alert")).toHaveTextContent(MIC_REFUSED);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/kept on this device/i);
    await userEvent.click(screen.getByRole("button", { name: /^dismiss$/i }));
    expect(c.discard).toHaveBeenCalledTimes(1);
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordHud } from "@/components/recorder/record-hud";
import { useRecorderStore } from "@/lib/recorder/recorder-store";
import { MIC_REFUSED } from "@/lib/recorder/recording-mode";

/** #24: the waiting, Saving, Saved and error pills. Store state in, DOM out. */

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

function toSaved(micLost = false) {
  toRecording();
  state().tick(42_000);
  state().beginStop(micLost);
  state().beginUpload();
  state().finish();
}

function toSaveFailed() {
  toRecording();
  state().beginStop();
  state().beginUpload();
  state().fail("save-failed");
}

beforeEach(() => state().discard());

describe("RecordHud — waiting for the browser", () => {
  it("asks for a tab in Meeting", () => {
    state().requestStart(NOTE, "meeting");
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Choose a tab to share");
  });

  it("asks for the microphone in Mic only", () => {
    state().requestStart(NOTE, "mic");
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Allow your microphone");
  });

  it("offers no control, because none can close the browser's prompt", () => {
    state().requestStart(NOTE, "meeting");
    render(<RecordHud controls={controls()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("RecordHud — Saving", () => {
  it("shows one word for both internal steps, with the length frozen", () => {
    toRecording();
    state().tick(42_000);
    state().beginStop();
    const { rerender } = render(<RecordHud controls={controls()} />);
    const pill = screen.getByRole("status");
    expect(pill).toHaveTextContent("Saving");
    expect(pill).toHaveTextContent("0:42");

    act(() => state().beginUpload());
    rerender(<RecordHud controls={controls()} />);
    // The same element, the same words: nothing new to announce.
    expect(screen.getByRole("status")).toBe(pill);
    expect(pill).toHaveTextContent("Saving");
    expect(pill).not.toHaveTextContent(/finishing|uploading/i);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("RecordHud — Saved", () => {
  afterEach(() => vi.useRealTimers());

  it("confirms the save and links to the new note", () => {
    toSaved();
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByRole("link", { name: "Open note" })).toHaveAttribute(
      "href",
      `/notes/${NOTE}`,
    );
    expect(screen.queryByText(/microphone lost/i)).toBeNull();
  });

  it("says why when the mic was lost", () => {
    toSaved(true);
    render(<RecordHud controls={controls()} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Microphone lost. Saved what was recorded.",
    );
  });

  it("goes back to Record after about six seconds", () => {
    vi.useFakeTimers();
    toSaved();
    render(<RecordHud controls={controls()} />);
    act(() => vi.advanceTimersByTime(5_900));
    expect(state().phase).toBe("saved");
    act(() => vi.advanceTimersByTime(200));
    expect(state().phase).toBe("idle");
    expect(screen.getByRole("button", { name: /record/i })).toBeInTheDocument();
  });

  it("holds while the pointer is on it", () => {
    vi.useFakeTimers();
    toSaved();
    render(<RecordHud controls={controls()} />);
    fireEvent.pointerEnter(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(20_000));
    expect(state().phase).toBe("saved");
    fireEvent.pointerLeave(screen.getByRole("status"));
    act(() => vi.advanceTimersByTime(6_100));
    expect(state().phase).toBe("idle");
  });

  it("holds while the user's keyboard focus is on it", () => {
    vi.useFakeTimers();
    toSaved();
    render(
      <>
        <input aria-label="Elsewhere" />
        <RecordHud controls={controls()} />
      </>,
    );
    const link = screen.getByRole("link", { name: "Open note" });
    // Tabbed in: focus arrives from another element.
    fireEvent.focusIn(link, { relatedTarget: screen.getByRole("textbox") });
    act(() => vi.advanceTimersByTime(20_000));
    expect(state().phase).toBe("saved");
    fireEvent.focusOut(link, { relatedTarget: screen.getByRole("textbox") });
    act(() => vi.advanceTimersByTime(6_100));
    expect(state().phase).toBe("idle");
  });

  // Review of #24: after a mouse Stop the HUD itself moves focus to "Open
  // note". That focus must not hold the pill open forever.
  it("still closes after a Stop that moved focus to Open note", async () => {
    toRecording();
    render(<RecordHud controls={controls()} />);
    await userEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    vi.useFakeTimers();
    act(() => {
      state().beginStop();
      state().beginUpload();
    });
    act(() => state().finish());
    expect(screen.getByRole("link", { name: "Open note" })).toHaveFocus();
    act(() => vi.advanceTimersByTime(6_100));
    expect(state().phase).toBe("idle");
    // Focus is not dropped on the body: it goes back to Record.
    expect(screen.getByRole("button", { name: /record/i })).toHaveFocus();
  });

  it("goes back to Record on a click", async () => {
    toSaved();
    render(<RecordHud controls={controls()} />);
    await userEvent.click(screen.getByText("Saved"));
    expect(state().phase).toBe("idle");
  });

  it("starts a new recording on ⌘⇧R", async () => {
    toSaved();
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.keyboard("{Control>}{Shift>}R{/Shift}{/Control}");
    expect(c.start).toHaveBeenCalled();
  });

  it("moves focus to Open note when focus was in the HUD", async () => {
    toRecording();
    render(<RecordHud controls={controls()} />);
    await userEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    // Stop unmounts with focus on it; focus falls to the page body.
    act(() => {
      state().beginStop();
      state().beginUpload();
    });
    act(() => state().finish());
    expect(screen.getByRole("link", { name: "Open note" })).toHaveFocus();
  });

  it("does not steal focus from what the user is doing elsewhere", () => {
    toRecording();
    state().beginStop();
    state().beginUpload();
    render(
      <>
        <input aria-label="Elsewhere" />
        <RecordHud controls={controls()} />
      </>,
    );
    const elsewhere = screen.getByRole("textbox", { name: "Elsewhere" });
    act(() => elsewhere.focus());
    act(() => state().finish());
    expect(elsewhere).toHaveFocus();
  });
});

describe("RecordHud — errors", () => {
  it("says a failed save plainly, and that the audio is kept", () => {
    toSaveFailed();
    render(<RecordHud controls={controls()} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Could not save the recording.");
    expect(alert).toHaveTextContent("It is kept on this device.");
  });

  it("offers Retry on a failed save, in one press", async () => {
    toSaveFailed();
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    expect(c.retry).toHaveBeenCalledTimes(1);
    expect(c.discard).not.toHaveBeenCalled();
  });

  it("still asks twice before Dismiss deletes kept audio", async () => {
    toSaveFailed();
    const c = controls();
    render(<RecordHud controls={c} />);
    await userEvent.click(screen.getByRole("button", { name: /^dismiss$/i }));
    expect(c.discard).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^confirm dismiss$/i }));
    expect(c.discard).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["mic-refused", MIC_REFUSED],
    ["unsupported", "This browser cannot record audio."],
    ["start-failed", "Could not start recording. Try again."],
  ] as const)("says %s in plain words, with no Retry and nothing kept", (cause, copy) => {
    state().requestStart(NOTE, "mic");
    state().fail(cause);
    render(<RecordHud controls={controls()} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(copy);
    expect(alert).not.toHaveTextContent(/kept on this device/i);
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^dismiss$/i })).toBeInTheDocument();
  });

  it("moves focus to Retry when a save fails with focus in the HUD", () => {
    toRecording();
    state().beginStop();
    state().beginUpload();
    render(<RecordHud controls={controls()} />);
    act(() => state().fail("save-failed"));
    expect(screen.getByRole("button", { name: /^retry$/i })).toHaveFocus();
  });

  it("does not steal focus when a save fails while the user works elsewhere", () => {
    toRecording();
    state().beginStop();
    state().beginUpload();
    render(
      <>
        <input aria-label="Elsewhere" />
        <RecordHud controls={controls()} />
      </>,
    );
    const elsewhere = screen.getByRole("textbox", { name: "Elsewhere" });
    act(() => elsewhere.focus());
    act(() => state().fail("save-failed"));
    expect(elsewhere).toHaveFocus();
  });

  it("shows Saving while a Retry works", () => {
    toSaveFailed();
    render(<RecordHud controls={controls()} />);
    act(() => state().beginRetry());
    expect(screen.getByRole("status")).toHaveTextContent("Saving");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

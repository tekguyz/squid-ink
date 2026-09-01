import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import {
  TranscribeButton,
  POLL_INTERVAL_MS,
  POLL_TICK_LIMIT,
} from "@/components/note-detail/transcribe-button";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const triggerTranscription = vi.fn();
vi.mock("@/app/notes/actions", () => ({
  triggerTranscription: (...args: unknown[]) => triggerTranscription(...args),
}));

const readProcessingStatus = vi.fn();
vi.mock("@/lib/notes/transcription-status", () => ({
  readProcessingStatus: (...args: unknown[]) => readProcessingStatus(...args),
}));

const NOTE = "11111111-2222-3333-4444-555555555555";

/** Advance the poll by whole ticks, flushing the promise each readProcessingStatus
 *  returns. advanceTimersByTimeAsync alone is not enough — the .then() chain
 *  inside the interval callback settles on a later microtask turn. */
/** fireEvent, not userEvent: user-event schedules its own timers and
 *  deadlocks against vi.useFakeTimers here. The click is the whole
 *  interaction — there is no pointer path worth simulating. */
async function press() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });
}

/** Let the transition's async body settle. findByText cannot be used here —
 *  it polls on a real interval and deadlocks against the fake timers. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function tick(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  triggerTranscription.mockResolvedValue("started");
  readProcessingStatus.mockResolvedValue("uploading");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("TranscribeButton — when it exists at all", () => {
  it("is ABSENT from the DOM for a completed note", () => {
    const { container } = render(
      <TranscribeButton noteId={NOTE} status="completed" />,
    );
    // Absent, not disabled and not hidden: there is nothing to press.
    expect(container).toBeEmptyDOMElement();
  });

  it("offers NO control for a failed note — 'failed' is terminal", () => {
    // No retry affordance. This is the explicit design decision, not an
    // oversight, and this test is what stops one being added by accident.
    render(<TranscribeButton noteId={NOTE} status="failed" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("still SAYS what happened to a failed note", () => {
    // The decision was "no retry", not "no status". A control silently
    // ceasing to exist is not how the outcome of a press gets reported.
    render(<TranscribeButton noteId={NOTE} status="failed" />);
    expect(screen.getByText(/could not be transcribed/i)).toBeInTheDocument();
  });

  it("is ABSENT for a note that never started uploading", () => {
    const { container } = render(
      <TranscribeButton noteId={NOTE} status="local" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a pressable Transcribe for an 'uploading' note", () => {
    render(<TranscribeButton noteId={NOTE} status="uploading" />);
    const button = screen.getByRole("button", { name: /transcribe/i });
    expect(button).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("TranscribeButton — pressing it", () => {
  it("calls the Server Action with the note id", async () => {
    render(<TranscribeButton noteId={NOTE} status="uploading" />);

    await press();

    expect(triggerTranscription).toHaveBeenCalledWith(NOTE);
  });

  it("shows a working state and starts polling", async () => {
    render(<TranscribeButton noteId={NOTE} status="uploading" />);

    await press();
    expect(screen.getByRole("button")).toHaveAttribute("aria-disabled", "true");

    await tick();
    expect(readProcessingStatus).toHaveBeenCalledWith(NOTE);
  });

  it("refreshes the server-rendered page when the note completes", async () => {
    render(<TranscribeButton noteId={NOTE} status="uploading" />);

    await press();

    readProcessingStatus.mockResolvedValue("completed");
    await tick();

    // router.refresh(), never a client-side fetch of the transcript: the
    // transcript pane is a Server Component and must stay the only reader.
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps asking while the server view is still behind, rather than stalling", async () => {
    // REGRESSION. Clearing the interval on the first terminal reading left a
    // dead poll whenever router.refresh() came back with the OLD status: the
    // effect's dependencies had not changed, so nothing restarted it and the
    // button sat on "Transcribing…" for the rest of the session. Unmounting is
    // the stop condition — see the test below — not the first terminal read.
    render(<TranscribeButton noteId={NOTE} status="uploading" />);

    await press();
    readProcessingStatus.mockResolvedValue("failed");

    await tick();
    const afterFirst = readProcessingStatus.mock.calls.length;
    expect(refresh).toHaveBeenCalled();

    await tick(3);
    expect(readProcessingStatus.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it("says so, and stops working, when another caller already claimed the row", async () => {
    triggerTranscription.mockResolvedValue("not-claimed");
    render(<TranscribeButton noteId={NOTE} status="uploading" />);

    await press();

    await settle();
    expect(screen.getByRole("status")).toHaveTextContent(/already being transcribed\./i);
    expect(refresh).toHaveBeenCalled();
  });

  it("says the recording never landed when the object is missing", async () => {
    triggerTranscription.mockResolvedValue("no-audio");
    render(<TranscribeButton noteId={NOTE} status="uploading" />);

    await press();

    await settle();
    expect(screen.getByRole("status")).toHaveTextContent(/never finished uploading\./i);
  });
});

describe("TranscribeButton — accessibility", () => {
  it("keeps a live region mounted before it has anything to say", async () => {
    // A role="status" that appears at the same instant as its text is not
    // reliably announced. The region must already be in the tree.
    render(<TranscribeButton noteId={NOTE} status="uploading" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("ignores a press while it is already working", async () => {
    // aria-disabled does not block the click the native attribute would.
    render(<TranscribeButton noteId={NOTE} status="analyzing" />);
    await press();
    expect(triggerTranscription).not.toHaveBeenCalled();
  });
});

describe("TranscribeButton — an 'analyzing' note", () => {
  it("polls on mount without a click, and offers nothing to press", async () => {
    // The cron, or another tab, may have claimed it. The UI should reflect
    // that without the user having been the one who triggered it.
    render(<TranscribeButton noteId={NOTE} status="analyzing" />);

    // aria-disabled, not the native attribute: the element must stay in the
    // tab order and the accessibility tree so the label change is announced.
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(triggerTranscription).not.toHaveBeenCalled();

    await tick();
    expect(readProcessingStatus).toHaveBeenCalledWith(NOTE);
  });

  it("clears its interval on unmount", async () => {
    const { unmount } = render(
      <TranscribeButton noteId={NOTE} status="analyzing" />,
    );

    await tick();
    const reads = readProcessingStatus.mock.calls.length;
    expect(reads).toBeGreaterThan(0);

    unmount();
    await tick(3);
    expect(readProcessingStatus.mock.calls.length).toBe(reads);
  });

  it("gives up with a neutral message rather than polling forever", async () => {
    render(<TranscribeButton noteId={NOTE} status="analyzing" />);

    await tick(POLL_TICK_LIMIT + 1);

    expect(screen.getByText(/refresh to check/i)).toBeInTheDocument();
    // The message shares the button's live region rather than replacing the
    // subtree, so a keyboard user does not lose focus at the cap.
    expect(screen.getByRole("button")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/refresh to check/i);

    const reads = readProcessingStatus.mock.calls.length;
    await tick(3);
    expect(readProcessingStatus.mock.calls.length).toBe(reads);
  });
});

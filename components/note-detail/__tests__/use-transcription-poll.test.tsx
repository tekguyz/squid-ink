import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import {
  useTranscriptionPoll,
  POLL_INTERVAL_MS,
  POLL_LIMIT_MS,
} from "@/components/note-detail/use-transcription-poll";

const readProcessingStatus = vi.fn();
vi.mock("@/lib/notes/transcription-status", () => ({
  readProcessingStatus: (...args: unknown[]) => readProcessingStatus(...args),
}));

const NOTE = "11111111-2222-3333-4444-555555555555";

/** Advance by whole ticks, flushing the promise each read returns. */
async function tick(count: number) {
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  readProcessingStatus.mockReset();
  readProcessingStatus.mockResolvedValue("analyzing");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useTranscriptionPoll", () => {
  it("calls onSettled on a terminal status, and keeps asking until stopped", async () => {
    // Not clearing on the first terminal reading is deliberate: the caller's
    // refresh can come back still saying 'uploading', and nothing would
    // restart a poll that had already cleared itself.
    const onSettled = vi.fn();
    readProcessingStatus.mockResolvedValue("completed");

    renderHook(() => useTranscriptionPoll(NOTE, true, onSettled));

    await tick(3);
    expect(onSettled).toHaveBeenCalledTimes(3);
  });

  it("stops for good at the time cap and reports gaveUp", async () => {
    // THE REGRESSION THIS PINS, and the reason onSettled is held in a ref
    // rather than listed as an effect dependency. VERIFIED by putting it back
    // in the dependency list: this test fails and the other five still pass.
    //
    // The cap clears the interval and calls setGaveUp, which re-renders. A
    // caller that rebuilds its callback each render — which is every caller of
    // useRouter, since it returns a fresh object — then hands the effect a new
    // identity, so the effect re-runs and starts a FRESH interval. The poll
    // resurrects itself microseconds after its own cap stopped it, and runs
    // for the rest of the session. The ref is what makes the cap final.
    const { result } = renderHook(() =>
      useTranscriptionPoll(NOTE, true, () => {}),
    );

    expect(result.current.gaveUp).toBe(false);

    await tick(POLL_LIMIT_MS / POLL_INTERVAL_MS + 1);
    expect(result.current.gaveUp).toBe(true);

    const reads = readProcessingStatus.mock.calls.length;
    await tick(3);
    expect(readProcessingStatus.mock.calls.length).toBe(reads);
  });

  it("reads nothing while inactive", async () => {
    renderHook(() => useTranscriptionPoll(NOTE, false, () => {}));
    await tick(3);
    expect(readProcessingStatus).not.toHaveBeenCalled();
  });

  it("survives a failed read rather than letting it look like progress", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const onSettled = vi.fn();
    readProcessingStatus.mockRejectedValue(new Error("network down"));

    renderHook(() => useTranscriptionPoll(NOTE, true, onSettled));

    await tick(2);
    expect(onSettled).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("leaves nothing running after unmount", async () => {
    const { unmount } = renderHook(() =>
      useTranscriptionPoll(NOTE, true, () => {}),
    );

    await tick(2);
    const reads = readProcessingStatus.mock.calls.length;
    expect(reads).toBeGreaterThan(0);

    unmount();
    await tick(3);
    expect(readProcessingStatus.mock.calls.length).toBe(reads);
  });
});

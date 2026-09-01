import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioPlayer } from "@/components/note-detail/audio-player";

const loadNoteAudio = vi.fn();
vi.mock("@/lib/notes/audio-playback", () => ({
  loadNoteAudio: (...args: unknown[]) => loadNoteAudio(...args),
}));

const PATH = "user-1/note-1";
const revoke = vi.fn();

// jsdom implements no media pipeline at all: play() and pause() are stubs that
// throw "not implemented", and duration is always NaN.
const play = vi.fn(async () => {});
const pause = vi.fn();

function media() {
  return document.querySelector("audio") as HTMLAudioElement;
}

/** Stand in for the browser telling us how long the file is. */
function announceDuration(seconds: number) {
  const el = media();
  Object.defineProperty(el, "duration", { value: seconds, configurable: true });
  act(() => el.dispatchEvent(new Event("loadedmetadata")));
}

describe("AudioPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(HTMLMediaElement.prototype, { play, pause });
    loadNoteAudio.mockResolvedValue({
      url: "blob:fake",
      mimeType: "audio/webm",
      revoke,
    });
  });

  it("renders nothing at all when the note has no audio", () => {
    const { container } = render(<AudioPlayer storagePath={null} />);
    expect(container).toBeEmptyDOMElement();
    expect(loadNoteAudio).not.toHaveBeenCalled();
  });

  it("says it is loading before the bytes arrive", () => {
    render(<AudioPlayer storagePath={PATH} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("says the audio is unavailable when the object is not there", async () => {
    loadNoteAudio.mockResolvedValue(null);
    render(<AudioPlayer storagePath={PATH} />);
    expect(await screen.findByText(/audio unavailable/i)).toBeInTheDocument();
  });

  it("says the audio is unavailable instead of throwing when the read fails", async () => {
    loadNoteAudio.mockRejectedValue(new Error("denied"));
    render(<AudioPlayer storagePath={PATH} />);
    expect(await screen.findByText(/audio unavailable/i)).toBeInTheDocument();
  });

  it("offers a real button with an accessible name once the audio is ready", async () => {
    render(<AudioPlayer storagePath={PATH} />);
    const button = await screen.findByRole("button", { name: /play recording/i });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("plays on click and reports itself pressed", async () => {
    render(<AudioPlayer storagePath={PATH} />);
    const button = await screen.findByRole("button", { name: /play recording/i });
    await userEvent.click(button);
    expect(play).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
  });

  it("pauses on a second click", async () => {
    render(<AudioPlayer storagePath={PATH} />);
    const button = await screen.findByRole("button", { name: /play recording/i });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(pause).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
  });

  it("shows elapsed and duration as mm:ss in the mono face", async () => {
    render(<AudioPlayer storagePath={PATH} />);
    await screen.findByRole("button", { name: /play recording/i });
    announceDuration(125);
    const readout = screen.getByText("00:00 / 02:05");
    expect(readout.className).toContain("font-mono");
  });

  it("gives the seek control an accessible name and the real duration", async () => {
    render(<AudioPlayer storagePath={PATH} />);
    await screen.findByRole("button", { name: /play recording/i });
    announceDuration(125);
    const slider = screen.getByRole("slider", { name: /seek/i });
    expect(slider).toHaveAttribute("max", "125");
  });

  // jsdom has no media pipeline, so HTMLMediaElement.currentTime never moves on
  // its own. The property is replaced with a real one to observe the write.
  it("seeks the media element when the slider moves", async () => {
    render(<AudioPlayer storagePath={PATH} />);
    await screen.findByRole("button", { name: /play recording/i });
    announceDuration(125);

    let seeked = 0;
    Object.defineProperty(media(), "currentTime", {
      configurable: true,
      get: () => seeked,
      set: (value: number) => {
        seeked = value;
      },
    });

    const slider = screen.getByRole("slider", { name: /seek/i });
    fireEvent.change(slider, { target: { value: "60" } });

    expect(seeked).toBe(60);
    expect(screen.getByText("01:00 / 02:05")).toBeInTheDocument();
  });

  it("revokes the object URL on unmount so navigation leaks nothing", async () => {
    const { unmount } = render(<AudioPlayer storagePath={PATH} />);
    await screen.findByRole("button", { name: /play recording/i });
    unmount();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("revokes the old URL and loads the new one when the note changes", async () => {
    const { rerender } = render(<AudioPlayer storagePath={PATH} />);
    await screen.findByRole("button", { name: /play recording/i });
    rerender(<AudioPlayer storagePath="user-1/note-2" />);
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
    expect(loadNoteAudio).toHaveBeenLastCalledWith("user-1/note-2");
  });

  it("does not revoke a URL that never loaded", async () => {
    loadNoteAudio.mockResolvedValue(null);
    const { unmount } = render(<AudioPlayer storagePath={PATH} />);
    await screen.findByText(/audio unavailable/i);
    unmount();
    expect(revoke).not.toHaveBeenCalled();
  });
});

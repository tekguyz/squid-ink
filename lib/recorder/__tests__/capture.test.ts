import { describe, expect, it, vi } from "vitest";
import { startCapture } from "@/lib/recorder/capture";
import type { RecordingMode } from "@/lib/recorder/recording-mode";

/** Minimal fakes. jsdom has neither getDisplayMedia nor Web Audio. */
function fakeTrack(kind: string, deviceId?: string) {
  const ended: (() => void)[] = [];
  return {
    kind,
    stop: vi.fn(),
    getSettings: () => ({ deviceId }),
    addEventListener: (type: string, fn: () => void) => {
      if (type === "ended") ended.push(fn);
    },
    /** What the browser does when the user presses "Stop sharing". */
    end: () => {
      for (const fn of ended) fn();
    },
  };
}

type FakeTrack = ReturnType<typeof fakeTrack>;

function fakeStream(tracks: FakeTrack[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  } as unknown as MediaStream;
}

const fakeNode = () => ({ connect: vi.fn(), disconnect: vi.fn() });
type FakeNode = ReturnType<typeof fakeNode>;

function fakeContext() {
  const destination = { stream: fakeStream([fakeTrack("audio", "mixed")]) };
  return {
    destination,
    close: vi.fn(async () => {}),
    createMediaStreamDestination: vi.fn(() => destination),
    createMediaStreamSource: vi.fn((_s: MediaStream): FakeNode => fakeNode()),
    createGain: vi.fn(() => ({ ...fakeNode(), gain: { value: 1 } })),
    createAnalyser: vi.fn(() => ({ ...fakeNode(), fftSize: 0 })),
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  const micTrack = fakeTrack("audio", "mic-a");
  const sysAudio = fakeTrack("audio", "tab-a");
  const sysVideo = fakeTrack("video");
  const ctx = fakeContext();
  return {
    micTrack,
    sysAudio,
    sysVideo,
    ctx,
    value: {
      getUserMedia: vi.fn(async (_c: MediaStreamConstraints) => fakeStream([micTrack])),
      getDisplayMedia: vi.fn(async (_c: DisplayMediaStreamOptions) =>
        fakeStream([sysAudio, sysVideo]),
      ),
      createAudioContext: () => ctx as unknown as AudioContext,
      ...overrides,
    },
  };
}

/** Start a capture that is expected to succeed, and hand back its handles. */
async function started(mode: RecordingMode, value: unknown) {
  const outcome = await startCapture(mode, value as never);
  if (outcome.kind !== "started") throw new Error(`expected started, got ${outcome.kind}`);
  return outcome.handles;
}

/** What a browser prompt rejects with when the user cancels or refuses it. */
const refused = () =>
  vi.fn(async () => {
    throw new DOMException("Permission denied", "NotAllowedError");
  });

describe("startCapture", () => {
  it("asks for the mic with echoCancellation and nothing else", async () => {
    const d = deps();
    await started("meeting", d.value);
    expect(d.value.getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true },
    });
  });

  it("asks getDisplayMedia for video, because Chromium withholds tab audio otherwise", async () => {
    const d = deps();
    await started("meeting", d.value);
    const [constraints] = d.value.getDisplayMedia.mock.calls[0];
    expect(constraints.audio).toBe(true);
    expect(constraints.video).toBe(true);
  });

  it("stops the display video track immediately — we record audio only", async () => {
    const d = deps();
    await started("meeting", d.value);
    expect(d.sysVideo.stop).toHaveBeenCalled();
  });

  it("hands back the mixed destination stream, not the mic stream", async () => {
    const d = deps();
    const handles = await started("meeting", d.value);
    expect(handles.stream).toBe(d.ctx.destination.stream);
  });

  it("wires both sources into the graph", async () => {
    const d = deps();
    await started("meeting", d.value);
    expect(d.ctx.createMediaStreamSource).toHaveBeenCalledTimes(2);
  });

  it("exposes the mic device id for the device watcher", async () => {
    const d = deps();
    const handles = await started("meeting", d.value);
    expect(handles.micDeviceId()).toBe("mic-a");
  });

  it("replaceMic swaps the source without changing the recorder's stream", async () => {
    const d = deps();
    const handles = await started("meeting", d.value);
    const before = handles.stream;

    const newMic = fakeTrack("audio", "mic-b");
    d.value.getUserMedia.mockResolvedValueOnce(fakeStream([newMic]));
    await handles.replaceMic();

    expect(d.micTrack.stop).toHaveBeenCalled();
    expect(handles.micDeviceId()).toBe("mic-b");
    expect(handles.stream).toBe(before);
    expect(d.ctx.createMediaStreamSource).toHaveBeenCalledTimes(3);
  });

  it("stop() stops every track and closes the context", async () => {
    const d = deps();
    const handles = await started("meeting", d.value);
    handles.stop();
    expect(d.micTrack.stop).toHaveBeenCalled();
    expect(d.sysAudio.stop).toHaveBeenCalled();
    expect(d.ctx.close).toHaveBeenCalled();
  });

  it("reports a refused mic as its own outcome and releases the share", async () => {
    const d = deps({ getUserMedia: refused() });
    const outcome = await startCapture("meeting", d.value as never);
    expect(outcome.kind).toBe("mic-refused");
    expect(d.sysAudio.stop).toHaveBeenCalled();
    expect(d.sysVideo.stop).toHaveBeenCalled();
  });

  it("still throws a mic failure that is not a refusal, and releases the share", async () => {
    const d = deps({
      getUserMedia: vi.fn(async () => {
        throw new DOMException("No device", "NotFoundError");
      }),
    });
    await expect(startCapture("meeting", d.value as never)).rejects.toThrow(/No device/);
    expect(d.sysAudio.stop).toHaveBeenCalled();
  });
});

describe("startCapture in Meeting", () => {
  it("reports a cancelled share picker as cancelled, and never asks for the mic", async () => {
    const d = deps({ getDisplayMedia: refused() });
    const outcome = await startCapture("meeting", d.value as never);
    expect(outcome.kind).toBe("cancelled");
    expect(d.value.getUserMedia).not.toHaveBeenCalled();
  });

  // "Share audio" unticked, or a browser (Firefox, desktop Safari) that shares
  // no sound: the stream arrives with a video track and no audio track.
  it("reports a share with no audio track as no sound shared, and stops the share", async () => {
    const video = fakeTrack("video");
    const d = deps({ getDisplayMedia: vi.fn(async () => fakeStream([video])) });
    const outcome = await startCapture("meeting", d.value as never);
    expect(outcome.kind).toBe("no-sound");
    expect(video.stop).toHaveBeenCalled();
    expect(d.value.getUserMedia).not.toHaveBeenCalled();
  });

  // Chrome's "Stop sharing" bar mid-call. The recorder records the destination
  // stream, so the mic branch carries on alone.
  it("keeps recording on the mic when the shared track ends", async () => {
    const d = deps();
    const handles = await started("meeting", d.value);
    const before = handles.stream;
    const shareSource = d.ctx.createMediaStreamSource.mock.results[0].value as FakeNode;

    d.sysAudio.end();

    expect(shareSource.disconnect).toHaveBeenCalled();
    expect(d.micTrack.stop).not.toHaveBeenCalled();
    expect(d.ctx.close).not.toHaveBeenCalled();
    expect(handles.stream).toBe(before);
    expect(handles.micDeviceId()).toBe("mic-a");
  });
});

describe("startCapture in Mic only", () => {
  it("never asks for a shared tab", async () => {
    const d = deps();
    await started("mic", d.value);
    expect(d.value.getDisplayMedia).not.toHaveBeenCalled();
  });

  it("builds the graph from the mic alone and records the destination stream", async () => {
    const d = deps();
    const handles = await started("mic", d.value);
    expect(d.ctx.createMediaStreamSource).toHaveBeenCalledTimes(1);
    expect(handles.stream).toBe(d.ctx.destination.stream);
    expect(handles.micDeviceId()).toBe("mic-a");
  });

  it("can still swap the mic mid-recording", async () => {
    const d = deps();
    const handles = await started("mic", d.value);
    d.value.getUserMedia.mockResolvedValueOnce(fakeStream([fakeTrack("audio", "mic-b")]));
    await handles.replaceMic();
    expect(handles.micDeviceId()).toBe("mic-b");
  });

  it("reports a refused mic as its own outcome", async () => {
    const d = deps({ getUserMedia: refused() });
    const outcome = await startCapture("mic", d.value as never);
    expect(outcome.kind).toBe("mic-refused");
  });

  it("stop() stops the mic and closes the context", async () => {
    const d = deps();
    const handles = await started("mic", d.value);
    handles.stop();
    expect(d.micTrack.stop).toHaveBeenCalled();
    expect(d.ctx.close).toHaveBeenCalled();
  });
});

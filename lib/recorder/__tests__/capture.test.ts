import { describe, expect, it, vi } from "vitest";
import { startCapture } from "@/lib/recorder/capture";

/** Minimal fakes. jsdom has neither getDisplayMedia nor Web Audio. */
function fakeTrack(kind: string, deviceId?: string) {
  return {
    kind,
    stop: vi.fn(),
    getSettings: () => ({ deviceId }),
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

function fakeContext() {
  const destination = { stream: fakeStream([fakeTrack("audio", "mixed")]) };
  return {
    destination,
    close: vi.fn(async () => {}),
    createMediaStreamDestination: vi.fn(() => destination),
    createMediaStreamSource: vi.fn(() => fakeNode()),
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
    sysVideo,
    ctx,
    value: {
      getUserMedia: vi.fn(async () => fakeStream([micTrack])),
      getDisplayMedia: vi.fn(async () => fakeStream([sysAudio, sysVideo])),
      createAudioContext: () => ctx as unknown as AudioContext,
      ...overrides,
    },
  };
}

describe("startCapture", () => {
  it("asks for the mic with echoCancellation and nothing else", async () => {
    const d = deps();
    await startCapture(d.value as never);
    expect(d.value.getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true },
    });
  });

  it("asks getDisplayMedia for video, because Chromium withholds tab audio otherwise", async () => {
    const d = deps();
    await startCapture(d.value as never);
    const [constraints] = d.value.getDisplayMedia.mock.calls[0] as [
      { audio: boolean; video: boolean },
    ];
    expect(constraints.audio).toBe(true);
    expect(constraints.video).toBe(true);
  });

  it("stops the display video track immediately — we record audio only", async () => {
    const d = deps();
    await startCapture(d.value as never);
    expect(d.sysVideo.stop).toHaveBeenCalled();
  });

  it("hands back the mixed destination stream, not the mic stream", async () => {
    const d = deps();
    const handles = await startCapture(d.value as never);
    expect(handles.stream).toBe(d.ctx.destination.stream);
  });

  it("wires both sources into the graph", async () => {
    const d = deps();
    await startCapture(d.value as never);
    expect(d.ctx.createMediaStreamSource).toHaveBeenCalledTimes(2);
  });

  it("exposes the mic device id for the device watcher", async () => {
    const d = deps();
    const handles = await startCapture(d.value as never);
    expect(handles.micDeviceId()).toBe("mic-a");
  });

  it("replaceMic swaps the source without changing the recorder's stream", async () => {
    const d = deps();
    const handles = await startCapture(d.value as never);
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
    const handles = await startCapture(d.value as never);
    handles.stop();
    expect(d.micTrack.stop).toHaveBeenCalled();
    expect(d.ctx.close).toHaveBeenCalled();
  });

  it("releases the display stream when the mic prompt is refused", async () => {
    const d = deps({
      getUserMedia: vi.fn(async () => {
        throw new Error("NotAllowedError");
      }),
    });
    await expect(startCapture(d.value as never)).rejects.toThrow();
    expect(d.sysVideo.stop).toHaveBeenCalled();
  });
});

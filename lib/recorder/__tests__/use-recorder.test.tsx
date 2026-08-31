import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRecorder } from "@/lib/recorder/use-recorder";
import { useRecorderStore } from "@/lib/recorder/recorder-store";
import { discardBackup, listBackups } from "@/lib/recorder/audio-backup";

const USER = "8f1c2a3b-0000-4444-8888-aaaaaaaaaaaa";
const NOTE = "11111111-2222-3333-4444-555555555555";

// jsdom has no navigator.mediaDevices. The enumerated list deliberately omits
// "mic-a" — the id captureHandles.micDeviceId() reports — so a dispatched
// devicechange reads as the recording mic having gone away.
const deviceListeners = new Set<EventListener>();
Object.defineProperty(navigator, "mediaDevices", {
  configurable: true,
  value: {
    addEventListener: (_t: string, l: EventListener) => void deviceListeners.add(l),
    removeEventListener: (_t: string, l: EventListener) => void deviceListeners.delete(l),
    dispatchEvent: (e: Event) => {
      for (const l of deviceListeners) l(e);
      return true;
    },
    enumerateDevices: async () => [{ kind: "audioinput", deviceId: "mic-b" }],
  },
});

/** A MediaRecorder stand-in with hand-fired events. */
function fakeMediaRecorder() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    state: "inactive",
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (listeners[type] ??= []).push(fn);
    },
    emit(type: string, event: unknown) {
      for (const fn of listeners[type] ?? []) fn(event);
    },
  };
}

function makeDeps() {
  const recorder = fakeMediaRecorder();
  const captureHandles = {
    stream: {} as MediaStream,
    analyser: {
      fftSize: 0,
      frequencyBinCount: 4,
      getByteTimeDomainData: vi.fn(),
    } as unknown as AnalyserNode,
    micDeviceId: () => "mic-a",
    replaceMic: vi.fn(async () => {}),
    stop: vi.fn(),
  };
  const createNote = vi.fn(async (_i: unknown) => ({ id: NOTE }));

  // Typed against the real StorageBucketLike result shapes, so `data: null`
  // with an error is assignable in the failure tests.
  type UploadResult = {
    data: { path: string } | null;
    error: { message: string } | null;
  };
  type ListResult = {
    data: { name: string; metadata?: { size?: number } }[] | null;
    error: { message: string } | null;
  };

  const bucketApi = {
    upload: vi.fn(
      async (
        _path: string,
        _body: Blob,
        _opts: { contentType: string; upsert: boolean },
      ): Promise<UploadResult> => ({
        data: { path: `${USER}/${NOTE}` },
        error: null,
      }),
    ),
    list: vi.fn(
      async (_prefix: string, _opts?: { search?: string }): Promise<ListResult> => ({
        data: [{ name: NOTE, metadata: { size: 9 } }],
        error: null,
      }),
    ),
  };
  let clock = 0;
  return {
    recorder,
    captureHandles,
    createNote,
    bucketApi,
    deps: {
      capture: vi.fn(async () => captureHandles),
      createRecorder: () => recorder,
      isTypeSupported: (t: string) => t === "audio/webm;codecs=opus",
      newNoteId: () => NOTE,
      now: () => (clock += 1000),
      getUserId: async () => USER,
      bucket: () => bucketApi,
      createNote,
    },
  };
}

type Deps = ReturnType<typeof makeDeps>;
type Rendered = { current: ReturnType<typeof useRecorder> };

/** Drive a full recording through to the end of stop(). */
async function recordAndStop(result: Rendered, d: Deps) {
  await act(async () => {
    await result.current.start();
  });
  await act(async () => {
    d.recorder.emit("dataavailable", {
      data: new Blob(["audio"], { type: "audio/webm" }),
    });
  });
  await act(async () => {
    // stop() registers its "stop" listener synchronously, before the first
    // await suspends, so emitting straight afterwards is safe.
    const done = result.current.stop();
    d.recorder.emit("stop", {});
    await done;
  });
}

describe("useRecorder", () => {
  beforeEach(async () => {
    useRecorderStore.getState().discard();
    for (const b of await listBackups()) await discardBackup(b.noteId);
    deviceListeners.clear();
    vi.clearAllMocks();
  });

  it("moves the store to recording and records the negotiated mime type", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => {
      await result.current.start();
    });
    expect(useRecorderStore.getState().phase).toBe("recording");
    expect(useRecorderStore.getState().mimeType).toBe("audio/webm;codecs=opus");
    expect(d.recorder.start).toHaveBeenCalled();
  });

  it("fails cleanly when the browser supports no candidate container", async () => {
    const d = makeDeps();
    const { result } = renderHook(() =>
      useRecorder({ ...d.deps, isTypeSupported: () => false } as never),
    );
    await act(async () => {
      await result.current.start();
    });
    expect(useRecorderStore.getState().phase).toBe("error");
    expect(d.deps.capture).not.toHaveBeenCalled();
  });

  it("fails cleanly when a permission prompt is refused", async () => {
    const d = makeDeps();
    const { result } = renderHook(() =>
      useRecorder({
        ...d.deps,
        capture: async () => {
          throw new Error("NotAllowedError");
        },
      } as never),
    );
    await act(async () => {
      await result.current.start();
    });
    expect(useRecorderStore.getState().phase).toBe("error");
    expect(useRecorderStore.getState().errorMessage).toMatch(/NotAllowed/);
  });

  it("pauses and resumes both the recorder and the store", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => {
      await result.current.start();
    });
    act(() => result.current.pause());
    expect(useRecorderStore.getState().phase).toBe("paused");
    expect(d.recorder.pause).toHaveBeenCalled();
    act(() => result.current.resume());
    expect(useRecorderStore.getState().phase).toBe("recording");
    expect(d.recorder.resume).toHaveBeenCalled();
  });

  it("saves the blob to IndexedDB BEFORE it touches the network", async () => {
    const d = makeDeps();
    const order: string[] = [];
    d.bucketApi.upload.mockImplementation(async () => {
      order.push("upload");
      return { data: { path: `${USER}/${NOTE}` }, error: null };
    });
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    expect((await listBackups()).map((b) => b.noteId)).toContain(NOTE);
    expect(order).toEqual(["upload"]);
  });

  it("creates the note row BEFORE it uploads, and uploads to {user_id}/{note_id}", async () => {
    const d = makeDeps();
    const order: string[] = [];
    d.createNote.mockImplementation(async () => {
      order.push("createNote");
      return { id: NOTE };
    });
    d.bucketApi.upload.mockImplementation(async () => {
      order.push("upload");
      return { data: { path: `${USER}/${NOTE}` }, error: null };
    });

    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(order).toEqual(["createNote", "upload"]));

    expect(d.bucketApi.upload.mock.calls[0][0]).toBe(`${USER}/${NOTE}`);
    expect(d.createNote.mock.calls[0][0]).toMatchObject({
      noteId: NOTE,
      audioStoragePath: `${USER}/${NOTE}`,
    });
  });

  // The row is written once per recording, on the single path that reaches it.
  // There is no retry control: a failed upload does NOT re-enter this code, so
  // the action is never called twice for one note id from here. (The action is
  // an upsert regardless — app/notes/__tests__/actions.test.ts guards that —
  // but the hook must not rely on it to paper over a double call.)
  it("calls the note action exactly once per recording", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(useRecorderStore.getState().phase).toBe("idle"));
    expect(d.createNote).toHaveBeenCalledTimes(1);
  });

  // The HUD re-renders ~5x/second while recording (clock + level meter) and its
  // keydown effect depends on this object. An unstable identity tore the window
  // listener down and re-added it on every tick.
  it("returns a stable controls object across re-renders", () => {
    const d = makeDeps();
    const { result, rerender } = renderHook(() => useRecorder(d.deps as never));
    const first = result.current;
    rerender();
    rerender();
    expect(result.current).toBe(first);
  });

  it("has no retry control — a failed upload is surfaced, not silently re-driven", () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    expect(Object.keys(result.current).sort()).toEqual([
      "discard",
      "pause",
      "resume",
      "start",
      "stop",
    ]);
  });

  it("returns to idle once the upload lands", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(useRecorderStore.getState().phase).toBe("idle"));
  });

  it("KEEPS the backup after a successful upload — only 'completed' discards it", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(useRecorderStore.getState().phase).toBe("idle"));
    expect((await listBackups()).map((b) => b.noteId)).toContain(NOTE);
  });

  it("keeps the blob and the note id when the upload fails", async () => {
    const d = makeDeps();
    d.bucketApi.upload.mockResolvedValue({
      data: null,
      error: { message: "offline" },
    });
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(useRecorderStore.getState().phase).toBe("error"));
    expect(useRecorderStore.getState().noteId).toBe(NOTE);
    expect((await listBackups()).map((b) => b.noteId)).toContain(NOTE);
    // The row WAS written — it is created as the upload starts, so a failed
    // upload leaves a visible note at 'uploading' with its audio recoverable.
    // That is the point of writing it first.
    expect(d.createNote).toHaveBeenCalledTimes(1);
  });

  it("does not upload at all when the note row cannot be written", async () => {
    const d = makeDeps();
    d.createNote.mockRejectedValue(new Error("row-level security"));
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(useRecorderStore.getState().phase).toBe("error"));
    expect(d.bucketApi.upload).not.toHaveBeenCalled();
    expect((await listBackups()).map((b) => b.noteId)).toContain(NOTE);
  });

  it("re-acquires the mic when the device watcher reports it lost", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(d.captureHandles.replaceMic).toHaveBeenCalled());
    expect(useRecorderStore.getState().phase).toBe("recording");
  });

  it("discard() stops capture, clears the store and drops the blob", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.discard();
    });
    expect(d.captureHandles.stop).toHaveBeenCalled();
    expect(useRecorderStore.getState().phase).toBe("idle");
    expect(await listBackups()).toEqual([]);
  });
});

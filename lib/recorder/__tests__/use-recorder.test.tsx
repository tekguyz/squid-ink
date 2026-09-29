import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRecorder } from "@/lib/recorder/use-recorder";
import { useRecorderStore } from "@/lib/recorder/recorder-store";
import {
  discardBackup,
  listBackups,
  loadBackup,
  saveBackup,
} from "@/lib/recorder/audio-backup";
import { NO_SOUND_SHARED } from "@/lib/recorder/recording-mode";

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
  const markUploadFailed = vi.fn(async (_noteId: string) => {});
  const reopenFailedUpload = vi.fn(async (_noteId: string) => {});
  const backupsSafeToDiscard = vi.fn(async (_ids: string[]): Promise<string[]> => []);

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
    markUploadFailed,
    reopenFailedUpload,
    backupsSafeToDiscard,
    bucketApi,
    deps: {
      capture: vi.fn(async (_mode: string) => ({
        kind: "started" as const,
        handles: captureHandles,
      })),
      // Most cases here are about what happens once audio flows, so they run
      // on a device that cannot share sound: start() records Mic only at once.
      // The choice has its own block below.
      canShareSound: () => false,
      createRecorder: () => recorder,
      isTypeSupported: (t: string) => t === "audio/webm;codecs=opus",
      newNoteId: () => NOTE,
      now: () => (clock += 1000),
      getUserId: async () => USER,
      bucket: () => bucketApi,
      createNote,
      markUploadFailed,
      reopenFailedUpload,
      backupsSafeToDiscard,
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

/** Tell the device watcher the recording mic went away. */
async function loseMic() {
  await act(async () => {
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
    await Promise.resolve();
    await Promise.resolve();
  });
}

const phase = () => useRecorderStore.getState().phase;

describe("useRecorder", () => {
  beforeEach(async () => {
    useRecorderStore.getState().discard();
    for (const b of await listBackups()) await discardBackup(b.noteId);
    deviceListeners.clear();
    vi.clearAllMocks();
    // Every failure is logged where it is caught (#24). Silenced here, and
    // asserted on where it matters.
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(useRecorderStore.getState().errorCause).toBe("unsupported");
    expect(d.deps.capture).not.toHaveBeenCalled();
  });

  it("stores a cause, not the exception, and logs the raw error", async () => {
    const d = makeDeps();
    const { result } = renderHook(() =>
      useRecorder({
        ...d.deps,
        capture: async () => {
          throw new Error("AudioContext exploded");
        },
      } as never),
    );
    await act(async () => {
      await result.current.start();
    });
    expect(useRecorderStore.getState().phase).toBe("error");
    expect(useRecorderStore.getState().errorCause).toBe("start-failed");
    expect(console.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: "AudioContext exploded" }),
    );
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

  // The row is written once per recording. Retry writes it again only when the
  // first write never landed (below).
  it("calls the note action exactly once per recording", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(phase()).toBe("saved"));
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

  it("ends in saved with the note id and the recording's length", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => {
      await result.current.start();
    });
    act(() => useRecorderStore.getState().tick(42_000));
    await act(async () => {
      const done = result.current.stop();
      d.recorder.emit("stop", {});
      await done;
    });
    const s = useRecorderStore.getState();
    expect(s.phase).toBe("saved");
    expect(s.noteId).toBe(NOTE);
    expect(s.elapsedMs).toBe(42_000);
    expect(s.micLost).toBe(false);
  });

  it("KEEPS the backup after a successful upload — only 'completed' discards it", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(phase()).toBe("saved"));
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

  // TIER 1 of the two-tier reconciliation. Tier 2 is the cron sweep, which on
  // the Vercel Hobby daily schedule can take 24 h to notice. The client already
  // knows, so it writes 'failed' itself.
  it("marks the note failed immediately when the upload throws", async () => {
    const d = makeDeps();
    d.bucketApi.upload.mockResolvedValue({
      data: null,
      error: { message: "offline" },
    });
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(d.markUploadFailed).toHaveBeenCalledTimes(1));
    expect(d.markUploadFailed).toHaveBeenCalledWith(NOTE);
  });

  it("fails as save-failed, not with the server's words, and logs the raw error", async () => {
    const d = makeDeps();
    d.bucketApi.upload.mockResolvedValue({
      data: null,
      error: { message: "offline" },
    });
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(useRecorderStore.getState().phase).toBe("error"));
    expect(useRecorderStore.getState().errorCause).toBe("save-failed");
    expect(console.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: expect.stringMatching(/offline/) }),
    );
  });

  it("keeps the IndexedDB blob when it marks the note failed", async () => {
    const d = makeDeps();
    d.bucketApi.upload.mockResolvedValue({
      data: null,
      error: { message: "offline" },
    });
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(d.markUploadFailed).toHaveBeenCalled());
    expect((await listBackups()).map((b) => b.noteId)).toContain(NOTE);
  });

  it("does not mark a note failed on a successful upload", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(phase()).toBe("saved"));
    expect(d.markUploadFailed).not.toHaveBeenCalled();
  });

  // The discriminator. Tier 1 fires on "the client caught an error", with no
  // object-existence check behind it, so it must only cover the Storage
  // transfer. If the row was never written there is nothing to fail, and
  // failing on an unrelated throw would strand a note that uploaded fine —
  // outside this session, nothing moves a 'failed' note back (Retry, #24,
  // lives only in the session that recorded it).
  it("does not mark a note failed when the row was never written", async () => {
    const d = makeDeps();
    d.createNote.mockRejectedValue(new Error("row-level security"));
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(useRecorderStore.getState().phase).toBe("error"));
    expect(d.markUploadFailed).not.toHaveBeenCalled();
  });

  it("does not mark a note failed when the session lookup throws", async () => {
    const d = makeDeps();
    const { result } = renderHook(() =>
      useRecorder({
        ...d.deps,
        getUserId: async () => {
          throw new Error("not signed in");
        },
      } as never),
    );
    await recordAndStop(result, d);
    await waitFor(() => expect(useRecorderStore.getState().phase).toBe("error"));
    expect(d.markUploadFailed).not.toHaveBeenCalled();
  });

  // One write per failed attempt. If the write itself cannot land — an offline
  // client is the obvious case — tier 2 is the net. Building a retry here would
  // be a second reconciliation path for one failure.
  it("writes once and does not retry when the failure write itself throws", async () => {
    const d = makeDeps();
    d.bucketApi.upload.mockResolvedValue({
      data: null,
      error: { message: "offline" },
    });
    d.markUploadFailed.mockRejectedValue(new Error("also offline"));
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(useRecorderStore.getState().phase).toBe("error"));
    expect(d.markUploadFailed).toHaveBeenCalledTimes(1);
    expect(useRecorderStore.getState().errorCause).toBe("save-failed");
  });

  it("re-acquires the mic when the device watcher reports it lost", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => {
      await result.current.start();
    });
    await loseMic();
    await waitFor(() => expect(d.captureHandles.replaceMic).toHaveBeenCalled());
    expect(useRecorderStore.getState().phase).toBe("recording");
  });

  it("stops and saves by itself when the mic is lost and none replaces it", async () => {
    const d = makeDeps();
    d.captureHandles.replaceMic.mockRejectedValue(new Error("NotReadableError"));
    const order: string[] = [];
    d.bucketApi.upload.mockImplementation(async () => {
      order.push(`upload, backup kept: ${(await loadBackup(NOTE)) !== null}`);
      return { data: { path: `${USER}/${NOTE}` }, error: null };
    });
    d.recorder.stop.mockImplementation(() => d.recorder.emit("stop", {}));
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => {
      await result.current.start();
    });
    await loseMic();
    await waitFor(() => expect(phase()).toBe("saved"));
    expect(useRecorderStore.getState().micLost).toBe(true);
    expect(d.recorder.stop).toHaveBeenCalled();
    expect(order).toEqual(["upload, backup kept: true"]);
  });

  it("really keeps the audio when the mic is lost and the save then fails", async () => {
    const d = makeDeps();
    d.captureHandles.replaceMic.mockRejectedValue(new Error("NotReadableError"));
    d.bucketApi.upload.mockResolvedValue({ data: null, error: { message: "offline" } });
    d.recorder.stop.mockImplementation(() => d.recorder.emit("stop", {}));
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => {
      await result.current.start();
    });
    await loseMic();
    await waitFor(() => expect(phase()).toBe("error"));
    const s = useRecorderStore.getState();
    expect(s.errorCause).toBe("save-failed");
    expect(s.noteId).toBe(NOTE);
    expect(await loadBackup(NOTE)).not.toBeNull();
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

  const backup = (noteId: string) => ({
    noteId,
    blob: new Blob(["audio"]),
    mimeType: "audio/webm",
    durationSeconds: 1,
    savedAtMs: 0,
  });

  // #12. The dock mounts once per full page load, so this is "once per visit".
  it("on mount, discards the backups the server names and keeps the rest", async () => {
    const OLD = "99999999-9999-4999-8999-999999999999";
    await saveBackup(backup(NOTE));
    await saveBackup(backup(OLD));
    const d = makeDeps();
    d.backupsSafeToDiscard.mockResolvedValue([OLD]);

    renderHook(() => useRecorder(d.deps as never));

    await waitFor(async () => expect(await loadBackup(OLD)).toBeNull());
    expect(d.backupsSafeToDiscard).toHaveBeenCalledTimes(1);
    expect(await loadBackup(NOTE)).not.toBeNull();
  });

  it("a cleanup that throws is logged and does not break the recorder", async () => {
    await saveBackup(backup(NOTE));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = makeDeps();
    d.backupsSafeToDiscard.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useRecorder(d.deps as never));

    await waitFor(() => expect(error).toHaveBeenCalled());
    expect(await loadBackup(NOTE)).not.toBeNull();
    await act(async () => {
      await result.current.start();
    });
    expect(useRecorderStore.getState().phase).toBe("recording");
    error.mockRestore();
  });
});

/** #24: Retry saves again from the audio kept on this device. */
describe("useRecorder — retry", () => {
  beforeEach(async () => {
    useRecorderStore.getState().discard();
    for (const b of await listBackups()) await discardBackup(b.noteId);
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("exists, and does nothing outside a failed save", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    expect(Object.keys(result.current)).toContain("retry");
    await act(async () => {
      await result.current.retry();
    });
    expect(phase()).toBe("idle");
    expect(d.bucketApi.upload).not.toHaveBeenCalled();
  });

  it("re-uploads the kept audio to the same path and ends in saved", async () => {
    const d = makeDeps();
    d.bucketApi.upload.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(phase()).toBe("error"));

    await act(async () => {
      await result.current.retry();
    });

    expect(phase()).toBe("saved");
    expect(useRecorderStore.getState().noteId).toBe(NOTE);
    expect(d.bucketApi.upload).toHaveBeenCalledTimes(2);
    expect(d.bucketApi.upload.mock.calls[1][0]).toBe(`${USER}/${NOTE}`);
    expect(await d.bucketApi.upload.mock.calls[1][1].text()).toBe("audio");
    // The row exists at 'failed': it is moved back, not written again.
    expect(d.reopenFailedUpload).toHaveBeenCalledWith(NOTE);
    expect(d.createNote).toHaveBeenCalledTimes(1);
  });

  it("writes the row first when the first save never wrote it", async () => {
    const d = makeDeps();
    const order: string[] = [];
    d.createNote.mockRejectedValueOnce(new Error("offline"));
    d.bucketApi.upload.mockImplementation(async () => {
      order.push("upload");
      return { data: { path: `${USER}/${NOTE}` }, error: null };
    });
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(phase()).toBe("error"));
    d.createNote.mockImplementation(async () => {
      order.push("createNote");
      return { id: NOTE };
    });

    await act(async () => {
      await result.current.retry();
    });

    expect(phase()).toBe("saved");
    expect(order).toEqual(["createNote", "upload"]);
    expect(d.reopenFailedUpload).not.toHaveBeenCalled();
  });

  it("returns to save-failed when it fails again, and marks the note failed once", async () => {
    const d = makeDeps();
    d.bucketApi.upload.mockResolvedValue({ data: null, error: { message: "offline" } });
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await recordAndStop(result, d);
    await waitFor(() => expect(phase()).toBe("error"));
    expect(d.markUploadFailed).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.retry();
    });

    const s = useRecorderStore.getState();
    expect(s.phase).toBe("error");
    expect(s.errorCause).toBe("save-failed");
    expect(s.noteId).toBe(NOTE);
    expect(d.markUploadFailed).toHaveBeenCalledTimes(2);
    expect(await loadBackup(NOTE)).not.toBeNull();
  });
});

/** #20: the recording mode. */
describe("useRecorder — choosing a mode", () => {
  beforeEach(() => {
    useRecorderStore.getState().discard();
    vi.clearAllMocks();
  });

  function withOutcome(outcome: unknown, canShareSound = true) {
    const d = makeDeps();
    const capture = vi.fn(async (_mode: string) => outcome);
    return { d, capture, deps: { ...d.deps, canShareSound: () => canShareSound, capture } };
  }

  it("opens the choice on a device that can share sound, and asks for nothing yet", async () => {
    const d = makeDeps();
    const { result } = renderHook(() =>
      useRecorder({ ...d.deps, canShareSound: () => true } as never),
    );
    await act(async () => {
      await result.current.start();
    });
    expect(useRecorderStore.getState().phase).toBe("choosing");
    expect(d.deps.capture).not.toHaveBeenCalled();
  });

  it("records Mic only at once on a device that cannot share sound", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => {
      await result.current.start();
    });
    expect(d.deps.capture).toHaveBeenCalledWith("mic");
    expect(useRecorderStore.getState().phase).toBe("recording");
    expect(useRecorderStore.getState().mode).toBe("mic");
  });

  it("records exactly the mode chosen", async () => {
    const d = makeDeps();
    const { result } = renderHook(() =>
      useRecorder({ ...d.deps, canShareSound: () => true } as never),
    );
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.choose("meeting");
    });
    expect(d.deps.capture).toHaveBeenCalledTimes(1);
    expect(d.deps.capture).toHaveBeenCalledWith("meeting");
    expect(useRecorderStore.getState().phase).toBe("recording");
    expect(useRecorderStore.getState().mode).toBe("meeting");
  });

  it("goes back to the choice with no error when the share picker is cancelled", async () => {
    const t = withOutcome({ kind: "cancelled" });
    const { result } = renderHook(() => useRecorder(t.deps as never));
    await act(async () => {
      await result.current.start();
      await result.current.choose("meeting");
    });
    const s = useRecorderStore.getState();
    expect(s.phase).toBe("choosing");
    expect(s.errorCause).toBeNull();
    expect(s.notice).toBeNull();
    // Never falls through to Mic only by itself.
    expect(t.capture).toHaveBeenCalledTimes(1);
  });

  it("goes back to the choice with the plain message when no sound was shared", async () => {
    const t = withOutcome({ kind: "no-sound" });
    const { result } = renderHook(() => useRecorder(t.deps as never));
    await act(async () => {
      await result.current.start();
      await result.current.choose("meeting");
    });
    expect(useRecorderStore.getState().phase).toBe("choosing");
    expect(useRecorderStore.getState().notice).toBe(NO_SOUND_SHARED);
  });

  it("shows the plain message, not the exception, when the mic is refused", async () => {
    const t = withOutcome({ kind: "mic-refused" });
    const { result } = renderHook(() => useRecorder(t.deps as never));
    await act(async () => {
      await result.current.start();
      await result.current.choose("mic");
    });
    const s = useRecorderStore.getState();
    expect(s.phase).toBe("error");
    expect(s.errorCause).toBe("mic-refused");
    // No audio exists, so nothing claims to be kept on this device.
    expect(s.noteId).toBeNull();
  });

  // The dock's start-request counter can call start() mid-recording. On a
  // device that cannot share sound that goes straight to choose("mic"), which
  // must not open a second capture over the running one.
  it("does not capture again while a recording is running", async () => {
    const d = makeDeps();
    const { result } = renderHook(() => useRecorder(d.deps as never));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.start();
      await result.current.choose("meeting");
    });
    expect(d.deps.capture).toHaveBeenCalledTimes(1);
    expect(useRecorderStore.getState().phase).toBe("recording");
  });

  it("shows the same message on a device that cannot share sound", async () => {
    const t = withOutcome({ kind: "mic-refused" }, false);
    const { result } = renderHook(() => useRecorder(t.deps as never));
    await act(async () => {
      await result.current.start();
    });
    expect(useRecorderStore.getState().errorCause).toBe("mic-refused");
  });
});

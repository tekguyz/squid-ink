"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { browserDeps, readLevel, type RecorderDeps } from "@/lib/recorder/browser-deps";
import { discardBackup, saveBackup } from "@/lib/recorder/audio-backup";
import { pickMimeType } from "@/lib/recorder/codec";
import { type CaptureHandles } from "@/lib/recorder/capture";
import { watchAudioInputs } from "@/lib/recorder/device-handoff";
import { recordingPath, uploadRecording } from "@/lib/recorder/upload-audio";
import { useRecorderStore } from "@/lib/recorder/recorder-store";

export type { RecorderDeps };

/** How often the clock and the level meter refresh. 200 ms is fast enough to
 *  read as live and slow enough not to re-render the HUD on every frame. */
const TICK_MS = 200;

/**
 * There is deliberately no `retry`. The scope for this track is that a failed
 * upload is VISIBLE, not that it is recoverable in one click: the note row is
 * already written, the blob is already in IndexedDB, and both survive. Adding a
 * retry affordance would be inventing a feature the brief did not ask for.
 */
export interface RecorderControls {
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  discard(): Promise<void>;
}

/**
 * Wires the recorder store to the browser media APIs, Storage and the note
 * action. Every hard part lives in its own tested module; this is the glue and
 * the timers.
 *
 * `deps` exists so the whole flow can be driven in tests with fakes — jsdom has
 * no MediaRecorder, no getDisplayMedia and no Web Audio.
 */
export function useRecorder(overrides: Partial<RecorderDeps> = {}): RecorderControls {
  const depsRef = useRef<RecorderDeps>({ ...browserDeps(), ...overrides });
  depsRef.current = { ...browserDeps(), ...overrides };

  const capture = useRef<CaptureHandles | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const unwatch = useRef<(() => void) | null>(null);
  const lastTick = useRef(0);

  const store = useRecorderStore;

  // One interval drives both the clock and the level meter. It reads the store
  // rather than closing over it, so it never holds a stale phase.
  useEffect(() => {
    const id = setInterval(() => {
      const state = store.getState();
      if (state.phase !== "recording") return;
      const now = depsRef.current.now();
      const delta = lastTick.current === 0 ? TICK_MS : now - lastTick.current;
      lastTick.current = now;
      state.tick(delta);
      if (capture.current) state.setLevel(readLevel(capture.current.analyser));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [store]);

  const teardown = useCallback(() => {
    unwatch.current?.();
    unwatch.current = null;
    capture.current?.stop();
    capture.current = null;
    recorder.current = null;
    lastTick.current = 0;
  }, []);

  const start = useCallback(async () => {
    const deps = depsRef.current;
    const state = store.getState();

    const mimeType = pickMimeType(deps.isTypeSupported);
    if (!mimeType) {
      state.fail("This browser cannot record audio.");
      return;
    }

    const noteId = deps.newNoteId();
    state.requestStart(noteId);

    try {
      const handles = await deps.capture();
      capture.current = handles;
      chunks.current = [];

      const media = deps.createRecorder(handles.stream, mimeType);
      media.addEventListener("dataavailable", (event) => {
        const blob = (event as BlobEvent).data;
        if (blob && blob.size > 0) chunks.current.push(blob);
      });
      recorder.current = media;
      media.start(1000);

      // Restart the affected track cleanly rather than dropping the recording.
      // The MediaRecorder is attached to the mixed destination stream, which
      // replaceMic() does not touch, so recording continues across the swap.
      unwatch.current = watchAudioInputs({
        mediaDevices: navigator.mediaDevices,
        currentDeviceId: () => handles.micDeviceId(),
        onDeviceLost: () => {
          void handles.replaceMic().catch((error: unknown) => {
            store.getState().fail(`Microphone lost: ${String(error)}`);
          });
        },
      });

      lastTick.current = 0;
      state.confirmStart(mimeType);
    } catch (error) {
      teardown();
      store.getState().fail(error instanceof Error ? error.message : String(error));
    }
  }, [store, teardown]);

  const pause = useCallback(() => {
    recorder.current?.pause();
    store.getState().pause();
  }, [store]);

  const resume = useCallback(() => {
    recorder.current?.resume();
    lastTick.current = 0;
    store.getState().resume();
  }, [store]);

  const stop = useCallback(async () => {
    const deps = depsRef.current;
    const state = store.getState();
    const noteId = state.noteId;
    const mimeType = state.mimeType ?? "audio/webm";
    const durationSeconds = state.elapsedMs / 1000;
    if (!noteId) return;

    state.beginStop();

    const media = recorder.current;
    if (media) {
      await new Promise<void>((resolve) => {
        media.addEventListener("stop", () => resolve());
        media.stop();
      });
    }
    teardown();

    const blob = new Blob(chunks.current, { type: mimeType });

    // Backup BEFORE the network. A failed upload must leave recoverable audio.
    await saveBackup({
      noteId,
      blob,
      mimeType,
      durationSeconds,
      savedAtMs: deps.now(),
    });

    store.getState().beginUpload();

    // THE DISCRIMINATOR for tier-1 reconciliation. markUploadFailed writes a
    // TERMINAL 'failed' on nothing more than "the client caught an error" —
    // unlike tier 2, which confirms the object is absent first. So it may only
    // fire for a throw from the Storage transfer, once a row actually exists to
    // fail. A throw from the session lookup or from createNote means there is
    // no row (or no session), and failing on those would strand notes for
    // reasons that have nothing to do with the audio.
    let rowWritten = false;

    try {
      const userId = await deps.getUserId();
      // Deterministic, so the row can name the object before the object exists.
      const path = recordingPath(userId, noteId);

      // The row is written BEFORE the bytes move, at processing_status
      // 'uploading' — true at this instant. A failed upload therefore leaves a
      // visible note whose audio is still in IndexedDB, rather than a silent
      // loss; the write below is what stops it sitting there until the cron.
      //
      // This runs exactly once per recording. stop() is only reachable from a
      // live recording, and there is no retry control, so the action is never
      // called twice for one note id from here.
      await deps.createNote({ noteId, audioStoragePath: path, durationSeconds });
      rowWritten = true;

      await uploadRecording({
        bucket: deps.bucket(),
        userId,
        noteId,
        blob,
        contentType: mimeType,
      });
    } catch (error) {
      // HUD first: fail() is synchronous, so the error pill does not wait on a
      // round trip.
      store.getState().fail(error instanceof Error ? error.message : String(error));

      // TIER 1 (docs/KNOWN_GAPS.md § Recorder HUD). Tier 2's staleness sweep
      // reaches this row only after an hour, and the Vercel Hobby cron fires
      // once a day. The failure is already certain here, so it is written here.
      //
      // ONE write, no retry. If this throws — an offline client is the obvious
      // case — tier 2 is still the net, and a retry loop here would be a second
      // reconciliation path for a single failure. The original error stays on
      // the HUD; this one is logged and dropped.
      //
      // The IndexedDB backup is untouched: it is discarded only on 'completed',
      // and a 'failed' row keeps the only copy of its audio indefinitely.
      if (rowWritten) {
        try {
          await deps.markUploadFailed(noteId);
        } catch (writeError) {
          console.error("Could not mark the note failed:", writeError);
        }
      }
      return;
    }

    // Outside the try on purpose. A throw from here is not an upload failure,
    // and must not reach the catch above and fail a note that uploaded fine.
    //
    // The backup is deliberately NOT discarded — it waits for
    // processing_status === 'completed', which the transcription pipeline owns.
    store.getState().finish();
  }, [store, teardown]);

  const discard = useCallback(async () => {
    const noteId = store.getState().noteId;
    recorder.current?.stop();
    teardown();
    chunks.current = [];
    if (noteId) await discardBackup(noteId);
    store.getState().discard();
  }, [store, teardown]);

  // Memoised on purpose. Every callback above is already stable, but a fresh
  // object literal here would give consumers a new `controls` identity on every
  // render — and the HUD re-renders roughly five times a second while
  // recording, because it subscribes to the clock and the level meter. Its
  // keydown effect depends on this object, so an unstable identity tore the
  // window listener down and re-added it on every tick.
  return useMemo(
    () => ({ start, pause, resume, stop, discard }),
    [start, pause, resume, stop, discard],
  );
}

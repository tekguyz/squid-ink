"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { browserDeps, readLevel, type RecorderDeps } from "@/lib/recorder/browser-deps";
import { discardBackup } from "@/lib/recorder/audio-backup";
import { cleanUpBackups } from "@/lib/recorder/backup-cleanup";
import { pickMimeType } from "@/lib/recorder/codec";
import { type CaptureHandles } from "@/lib/recorder/capture";
import { watchAudioInputs } from "@/lib/recorder/device-handoff";
import { finishRecording, retrySave } from "@/lib/recorder/finish-recording";
import { useRecorderStore } from "@/lib/recorder/recorder-store";
import { NO_SOUND_SHARED, type RecordingMode } from "@/lib/recorder/recording-mode";

export type { RecorderDeps };

/** How often the clock and the level meter refresh. 200 ms is fast enough to
 *  read as live and slow enough not to re-render the HUD on every frame. */
const TICK_MS = 200;

export interface RecorderControls {
  /** Ask for a recording. Opens the Meeting / Mic only choice, or records Mic
   *  only at once on a device that cannot share sound (#20). Every entry — the
   *  HUD button, ⌘⇧R, the dock's start-request counter — comes through here. */
  start(): Promise<void>;
  /** Record in the chosen mode. Only the choice calls it. */
  choose(mode: RecordingMode): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  /** Save again from the audio kept on this device (#24). Only a failed save
   *  has any; everywhere else it does nothing. */
  retry(): Promise<void>;
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
  /** Whether the last save of the current note wrote its row, so Retry knows
   *  whether to write it or move it back from 'failed' (#24). */
  const rowWritten = useRef(false);
  /** `stop`, reachable from the device watcher, which is set up before `stop`
   *  is defined. */
  const stopRef = useRef<(micLost: boolean) => Promise<void>>(async () => {});

  const store = useRecorderStore;

  // #12: drop the IndexedDB backups the server says may go — 'completed' at
  // once, 'failed' after seven days. The dock mounts once per full page load,
  // so this runs once per visit. A failure only means the blobs wait for the
  // next visit, so it is logged, never shown.
  useEffect(() => {
    cleanUpBackups(depsRef.current.backupsSafeToDiscard).catch((error: unknown) => {
      console.error("Could not clean up audio backups:", error);
    });
  }, []);

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

  const choose = useCallback(async (mode: RecordingMode) => {
    const deps = depsRef.current;
    const state = store.getState();

    const mimeType = pickMimeType(deps.isTypeSupported);
    if (!mimeType) {
      state.fail("unsupported");
      return;
    }

    const noteId = deps.newNoteId();
    state.requestStart(noteId, mode);
    // requestStart is a no-op outside idle, choosing and error. A start that
    // arrives mid-recording must not open a second capture over the first.
    if (store.getState().phase !== "requesting") return;

    try {
      const outcome = await deps.capture(mode);
      // Cancel is a normal choice, not a crash: back to the choice, one tap
      // from Mic only. "No sound shared" goes back there too, with the reason.
      if (outcome.kind === "cancelled") return store.getState().backToChoice(null);
      if (outcome.kind === "no-sound") {
        return store.getState().backToChoice(NO_SOUND_SHARED);
      }
      if (outcome.kind === "mic-refused") return store.getState().fail("mic-refused");

      const { handles } = outcome;
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
      // With no mic left to swap in, the recording stops and saves what it
      // has (#24) — failing here would throw away audio never backed up.
      unwatch.current = watchAudioInputs({
        mediaDevices: navigator.mediaDevices,
        currentDeviceId: () => handles.micDeviceId(),
        onDeviceLost: () => {
          void handles.replaceMic().catch((error: unknown) => {
            console.error("Microphone lost, no replacement found:", error);
            void stopRef.current(true);
          });
        },
      });

      lastTick.current = 0;
      state.confirmStart(mimeType);
    } catch (error) {
      teardown();
      console.error("Could not start recording:", error);
      store.getState().fail("start-failed");
    }
  }, [store, teardown]);

  const start = useCallback(async () => {
    if (depsRef.current.canShareSound()) store.getState().openChoice();
    else await choose("mic");
  }, [store, choose]);

  const pause = useCallback(() => {
    recorder.current?.pause();
    store.getState().pause();
  }, [store]);

  const resume = useCallback(() => {
    recorder.current?.resume();
    lastTick.current = 0;
    store.getState().resume();
  }, [store]);

  const stopWith = useCallback(async (micLost: boolean) => {
    const state = store.getState();
    const noteId = state.noteId;
    const mimeType = state.mimeType ?? "audio/webm";
    const durationSeconds = state.elapsedMs / 1000;
    if (!noteId || (state.phase !== "recording" && state.phase !== "paused")) return;

    state.beginStop(micLost);

    const media = recorder.current;
    if (media) {
      await new Promise<void>((resolve) => {
        media.addEventListener("stop", () => resolve());
        media.stop();
      });
    }
    teardown();

    // Everything past this point is a pipeline over deps and the store with no
    // React in it, and it holds this track's most consequential ordering
    // decisions. It lives in finish-recording.ts so it can be driven directly.
    const outcome = await finishRecording({
      deps: depsRef.current,
      store,
      noteId,
      blob: new Blob(chunks.current, { type: mimeType }),
      mimeType,
      durationSeconds,
    });
    rowWritten.current = outcome.rowWritten;
  }, [store, teardown]);
  useEffect(() => {
    stopRef.current = stopWith;
  }, [stopWith]);

  const stop = useCallback(() => stopWith(false), [stopWith]);

  const retry = useCallback(async () => {
    const { phase, errorCause, noteId } = store.getState();
    if (phase !== "error" || errorCause !== "save-failed" || !noteId) return;
    const outcome = await retrySave({
      deps: depsRef.current,
      store,
      noteId,
      rowWritten: rowWritten.current,
    });
    rowWritten.current = outcome.rowWritten;
  }, [store]);

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
    () => ({ start, choose, pause, resume, stop, retry, discard }),
    [start, choose, pause, resume, stop, retry, discard],
  );
}

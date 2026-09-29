import { create } from "zustand";
import type { RecordingMode } from "@/lib/recorder/recording-mode";

/**
 * Recorder state, held once at module scope.
 *
 * This is the first real consumer of Zustand in this codebase, and it is here
 * for one reason: DECISIONS.md scopes Zustand to "recorder HUD/dock state", and
 * the HUD is mounted in the root layout so it survives every navigation. A
 * `useState` in a route-level component would be torn down by the first link
 * click, which is exactly the "ambient, not calendar-gated" requirement
 * failing.
 *
 * The store lives at MODULE scope, not inside a provider a route could
 * re-mount. Importing this module twice yields the same state — there is a test
 * for that, because it is the property the whole track rests on.
 *
 * Every illegal transition is a no-op, never a throw. The HUD renders on every
 * route in the app; a stray event from a keyboard shortcut arriving one tick
 * late must not take the whole page down with it.
 *
 * `choosing` (#20) is the Meeting / Mic only choice. Every ask for a recording
 * on a device that can share sound lands there first, and a cancelled share
 * picker or a share with no sound goes back there — never to `error`, and
 * never on to Mic only by itself.
 *
 * `stopping` and `uploading` are two internal steps the HUD shows as one
 * "Saving" (#24). `saved` follows a successful save and holds the note id and
 * the frozen length until the HUD closes it or a new recording starts.
 */
export type RecorderPhase =
  | "idle"
  | "choosing"
  | "requesting"
  | "recording"
  | "paused"
  | "stopping"
  | "uploading"
  | "saved"
  | "error";

/** Why the HUD is in `error` (#24). The store holds a cause, never raw browser
 *  or server text; the HUD maps each cause to plain words, and the raw error
 *  is logged where it was caught. Only `save-failed` has audio behind it. */
export type RecorderErrorCause =
  | "mic-refused"
  | "unsupported"
  | "save-failed"
  | "start-failed";

/** Phases a new recording may start from: nothing is running. */
const AT_REST: readonly RecorderPhase[] = ["idle", "saved", "error"];
export const isAtRest = (phase: RecorderPhase) => AT_REST.includes(phase);

export interface RecorderState {
  phase: RecorderPhase;
  /** Generated before capture starts, because it names the Storage object.
   *  Kept through a failed save so Retry upserts the same path, and through
   *  `saved` so the HUD can link to the new note. */
  noteId: string | null;
  /** The mode of the recording being requested or made. Only the HUD's
   *  screen-reader line reads it; it is not saved on the note. */
  mode: RecordingMode | null;
  /** A plain-words line shown on the choice after a Meeting attempt came back
   *  with no sound. Null when the choice opens fresh or after a Cancel. */
  notice: string | null;
  elapsedMs: number;
  /** Mic level, 0..1. System audio is deliberately excluded — the meter
   *  answers "is my microphone working", which is the question a user has. */
  level: number;
  mimeType: string | null;
  errorCause: RecorderErrorCause | null;
  /** The recording stopped by itself because its mic was lost and no other
   *  was found (#24). Carried from the stop to `saved`. */
  micLost: boolean;

  /** How many times something outside the dock has asked for a recording to
   *  begin. It is a counter rather than a boolean so two asks in a row are two
   *  distinct values, and it is deliberately NOT part of CLEAN — a reset that
   *  rewound it to 0 would let the next ask re-fire a request already served.
   *
   *  Only the dock reads it, and only to call the one `useRecorder` instance
   *  it owns. That indirection is the whole point: `useRecorder` holds the
   *  MediaRecorder, the capture graph and the device watcher in refs, so a
   *  second component calling the hook would be a second recorder whose Pause
   *  and Stop reach nothing. There is one recorder; this is how anything else
   *  on screen asks it to start. */
  startRequests: number;

  requestRecording(): void;
  openChoice(): void;
  closeChoice(): void;
  requestStart(noteId: string, mode: RecordingMode): void;
  backToChoice(notice: string | null): void;
  confirmStart(mimeType: string): void;
  pause(): void;
  resume(): void;
  beginStop(micLost?: boolean): void;
  beginUpload(): void;
  finish(): void;
  closeSaved(): void;
  beginRetry(): void;
  fail(cause: RecorderErrorCause): void;
  discard(): void;
  tick(deltaMs: number): void;
  setLevel(level: number): void;
}

/** What a reset restores. `startRequests` is omitted on purpose — see its
 *  comment above; it is state that must survive `discard()` and `finish()`. */
type RecorderData = Omit<
  RecorderState,
  | "startRequests"
  | "requestRecording"
  | "openChoice"
  | "closeChoice"
  | "requestStart"
  | "backToChoice"
  | "confirmStart"
  | "pause"
  | "resume"
  | "beginStop"
  | "beginUpload"
  | "finish"
  | "closeSaved"
  | "beginRetry"
  | "fail"
  | "discard"
  | "tick"
  | "setLevel"
>;

const CLEAN: RecorderData = {
  phase: "idle",
  noteId: null,
  mode: null,
  notice: null,
  elapsedMs: 0,
  level: 0,
  mimeType: null,
  errorCause: null,
  micLost: false,
};

export const useRecorderStore = create<RecorderState>((set) => ({
  ...CLEAN,
  startRequests: 0,

  // Guarded like every other transition: asking to record while a recording is
  // already running is a no-op, not a throw. The dock is mounted on every
  // route, so a stray click arriving one tick late must not take the page down.
  requestRecording: () =>
    set((s) => (AT_REST.includes(s.phase) ? { startRequests: s.startRequests + 1 } : s)),

  openChoice: () =>
    set((s) => (AT_REST.includes(s.phase) ? { ...CLEAN, phase: "choosing" } : s)),

  closeChoice: () => set((s) => (s.phase === "choosing" ? { ...CLEAN } : s)),

  requestStart: (noteId, mode) =>
    set((s) =>
      AT_REST.includes(s.phase) || s.phase === "choosing"
        ? { ...CLEAN, phase: "requesting", noteId, mode }
        : s,
    ),

  // The note id goes: nothing was recorded under it, and the next attempt
  // mints its own.
  backToChoice: (notice) =>
    set((s) =>
      s.phase === "requesting" ? { ...CLEAN, phase: "choosing", notice } : s,
    ),

  confirmStart: (mimeType) =>
    set((s) => (s.phase === "requesting" ? { phase: "recording", mimeType } : s)),

  pause: () => set((s) => (s.phase === "recording" ? { phase: "paused" } : s)),

  resume: () => set((s) => (s.phase === "paused" ? { phase: "recording" } : s)),

  beginStop: (micLost = false) =>
    set((s) =>
      s.phase === "recording" || s.phase === "paused"
        ? { phase: "stopping", level: 0, micLost }
        : s,
    ),

  beginUpload: () =>
    set((s) => (s.phase === "stopping" ? { phase: "uploading" } : s)),

  // Keeps the note id, the frozen length and micLost: the Saved pill shows
  // all three.
  finish: () => set((s) => (s.phase === "uploading" ? { phase: "saved" } : s)),

  closeSaved: () => set((s) => (s.phase === "saved" ? { ...CLEAN } : s)),

  // Retry (#24) is reachable only from a failed save, the one error with audio
  // kept on this device. It re-enters the same "Saving" the first save showed.
  beginRetry: () =>
    set((s) =>
      s.phase === "error" && s.errorCause === "save-failed" && s.noteId
        ? { phase: "uploading", errorCause: null }
        : s,
    ),

  // Only a failed save has audio behind it, so only it keeps the note id — the
  // HUD reads a note id in `error` as "audio kept on this device", and for any
  // other cause that would be false. micLost is dropped: a failed save shows
  // the normal save-failed pill.
  fail: (cause) =>
    set((s) => ({
      phase: "error",
      errorCause: cause,
      level: 0,
      micLost: false,
      noteId: cause === "save-failed" ? s.noteId : null,
    })),

  discard: () => set({ ...CLEAN }),

  tick: (deltaMs) =>
    set((s) => (s.phase === "recording" ? { elapsedMs: s.elapsedMs + deltaMs } : s)),

  setLevel: (level) => set({ level: Math.min(1, Math.max(0, level)) }),
}));

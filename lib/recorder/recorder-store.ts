import { create } from "zustand";

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
 */
export type RecorderPhase =
  | "idle"
  | "requesting"
  | "recording"
  | "paused"
  | "stopping"
  | "uploading"
  | "error";

export interface RecorderState {
  phase: RecorderPhase;
  /** Generated before capture starts, because it names the Storage object.
   *  Kept through `error` so a retry upserts the same path. */
  noteId: string | null;
  elapsedMs: number;
  /** Mic level, 0..1. System audio is deliberately excluded — the meter
   *  answers "is my microphone working", which is the question a user has. */
  level: number;
  mimeType: string | null;
  errorMessage: string | null;

  requestStart(noteId: string): void;
  confirmStart(mimeType: string): void;
  pause(): void;
  resume(): void;
  beginStop(): void;
  beginUpload(): void;
  finish(): void;
  fail(message: string): void;
  discard(): void;
  tick(deltaMs: number): void;
  setLevel(level: number): void;
}

type RecorderData = Omit<
  RecorderState,
  | "requestStart"
  | "confirmStart"
  | "pause"
  | "resume"
  | "beginStop"
  | "beginUpload"
  | "finish"
  | "fail"
  | "discard"
  | "tick"
  | "setLevel"
>;

const CLEAN: RecorderData = {
  phase: "idle",
  noteId: null,
  elapsedMs: 0,
  level: 0,
  mimeType: null,
  errorMessage: null,
};

export const useRecorderStore = create<RecorderState>((set) => ({
  ...CLEAN,

  requestStart: (noteId) =>
    set((s) =>
      s.phase === "idle" || s.phase === "error"
        ? { ...CLEAN, phase: "requesting", noteId }
        : s,
    ),

  confirmStart: (mimeType) =>
    set((s) => (s.phase === "requesting" ? { phase: "recording", mimeType } : s)),

  pause: () => set((s) => (s.phase === "recording" ? { phase: "paused" } : s)),

  resume: () => set((s) => (s.phase === "paused" ? { phase: "recording" } : s)),

  beginStop: () =>
    set((s) =>
      s.phase === "recording" || s.phase === "paused"
        ? { phase: "stopping", level: 0 }
        : s,
    ),

  // Reachable only from `stopping`. There is no retry: a failed upload is
  // surfaced and left alone, because this track's requirement is that the
  // failure be VISIBLE, not that it be recoverable in one click. `noteId` still
  // survives a failure — that is how the error state knows which IndexedDB blob
  // is the orphaned one — but nothing re-enters the upload from here.
  beginUpload: () =>
    set((s) => (s.phase === "stopping" ? { phase: "uploading" } : s)),

  finish: () => set((s) => (s.phase === "uploading" ? { ...CLEAN } : s)),

  fail: (message) => set({ phase: "error", errorMessage: message, level: 0 }),

  discard: () => set({ ...CLEAN }),

  tick: (deltaMs) =>
    set((s) => (s.phase === "recording" ? { elapsedMs: s.elapsedMs + deltaMs } : s)),

  setLevel: (level) => set({ level: Math.min(1, Math.max(0, level)) }),
}));

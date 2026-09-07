"use client";

import { formatElapsed } from "@/lib/recorder/format-elapsed";
import { useRecorderStore } from "@/lib/recorder/recorder-store";

/**
 * The feed's header bar, App Surfaces 01.
 *
 * A client component for one reason: the Record button. It does not own a
 * recorder — it raises `requestRecording()` on the module-scope store, and the
 * dock mounted in app/layout.tsx serves it with the single `useRecorder`
 * instance that holds the MediaRecorder. Calling the hook here would create a
 * second recorder whose Pause and Stop reach nothing.
 *
 * Search and Import audio render disabled. There is no search index and no
 * import path; a control that looks live and does nothing is worse than one
 * that says it is not ready.
 *
 * While a recording is in flight the Record button is REPLACED, not disabled —
 * changed 2026-09-07 after a design critique. A greyed-out Record with no
 * explanation is indistinguishable from a broken button: the recording is
 * running, the header is the place the user just pressed, and the control that
 * ends it lives in a corner they were never pointed at. The replacement is a
 * read-only `role="status"` readout — the live marker, the elapsed clock, and
 * a line naming where Stop is.
 *
 * It adds NO second way to stop a recording. There is one recorder and one
 * stop path, the HUD's own Stop button, exactly as `startRequests` in
 * recorder-store.ts is the one way to ask for a start. Nothing here calls a
 * control, raises a counter, or reaches the store for anything but two reads —
 * `phase` and `elapsedMs`. The header tells you the recorder is running and
 * where its Stop is; the HUD still owns pressing it.
 */

/** Shared by the two dead controls. No `--control-edge`: that token is the
 *  boundary of something you can actually operate, and neither of these is.
 *
 *  The `opacity-60` moved off this shared class and onto the dimmed label
 *  alone on 2026-09-07 — composited, `text-faint` under it measured 1.81:1 on
 *  `bg-paper` light and 1.88:1 dark, and it was dragging the border down to
 *  1.22:1 as well. See identity-rail.tsx's PendingItem for the full
 *  measurement and the reasoning; the two files are one decision. */
const DISABLED_CONTROL =
  "border-rule-2 text-faint flex cursor-not-allowed items-center border";

/** The state badge on a dead control, at full `muted` so the word explaining
 *  the control is legible even though the control is not. */
const SOON_BADGE =
  "font-mono text-muted text-[8.5px] tracking-[0.14em] uppercase";

const MONO_ACTION = "font-mono text-[10px] tracking-[0.06em] uppercase";

/** What the readout says for each in-flight phase, and whether the recorder is
 *  far enough along that Stop is on screen. `requesting` has no HUD control yet
 *  — the browser's own permission prompt is in front of the user — and
 *  `stopping`/`uploading` are already past the point of stopping. */
const LIVE_PHASES = new Set(["recording", "paused"]);

const READOUT: Record<string, string> = {
  requesting: "Waiting for permission",
  recording: "Recording",
  paused: "Paused",
  stopping: "Finishing",
  uploading: "Uploading",
};

export function DashboardHeader() {
  const phase = useRecorderStore((s) => s.phase);
  const elapsedMs = useRecorderStore((s) => s.elapsedMs);
  const requestRecording = useRecorderStore((s) => s.requestRecording);
  const busy = phase !== "idle" && phase !== "error";

  return (
    <header className="border-rule flex items-center gap-[14px] border-b px-[24px] pt-[18px] pb-[13px]">
      <h1 className="font-header text-ink flex-none text-[22px] font-semibold tracking-[-0.01em]">
        All notes
      </h1>

      {/* The leading `/` glyph is gone. No key binding exists, so it taught a
          shortcut that did nothing — the same fault as the `⌘,` the rail used
          to carry. The badge replaces it and says the true thing instead. */}
      <div
        aria-hidden
        className={`${DISABLED_CONTROL} min-w-0 max-w-[320px] flex-1 gap-[8px] px-[10px] py-[6px]`}
      >
        <span className="font-body truncate text-[12.5px] opacity-60">
          Search notes, speakers, sources
        </span>
        <span className={`${SOON_BADGE} ml-auto flex-none`}>Soon</span>
      </div>

      <div className="ml-auto flex flex-none items-center gap-[8px]">
        {/* `title` removed: browsers suppress pointer events on a disabled
            element, so "Not available yet" provably never rendered and this
            control carried no explanation at all. The badge is visible. */}
        <button
          type="button"
          disabled
          className={`${DISABLED_CONTROL} ${MONO_ACTION} gap-[8px] px-[11px] py-[7px]`}
        >
          <span className="opacity-60">Import audio</span>
          <span className={SOON_BADGE}>Soon</span>
        </button>
        {busy ? (
          <div
            role="status"
            className={`${MONO_ACTION} border-control-edge text-ink-2 flex items-center gap-[8px] border px-[11px] py-[7px]`}
          >
            {/* Round, and the only round thing on this screen — the HUD's own
                recording dot is a circle for the same reason, and this is the
                same state. Every other marker in the app is a square. */}
            <span
              aria-hidden
              className={`h-[9px] w-[9px] ${
                LIVE_PHASES.has(phase) ? "bg-live rounded-full" : "bg-accent"
              }`}
            />
            <span>{READOUT[phase]}</span>
            {LIVE_PHASES.has(phase) ? (
              <>
                <span className="text-ink tabular-nums">
                  {formatElapsed(elapsedMs)}
                </span>
                <span aria-hidden className="bg-rule-2 h-[13px] w-px" />
                {/* The pointer, not a control. Stop lives in the recorder in
                    the bottom-right corner and there is exactly one of it. */}
                <span className="text-muted">Stop in the recorder ↘</span>
              </>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={requestRecording}
            className={`${MONO_ACTION} bg-accent text-on-accent hover:bg-accent-pressed focus-visible:outline-accent flex items-center gap-[7px] px-[13px] py-[7px] font-medium focus-visible:outline-2 focus-visible:outline-offset-1`}
          >
            {/* The same 9px square the HUD, the audio player and the Transcribe
                button use for a marker. Nothing here is round. */}
            <span aria-hidden className="bg-on-accent h-[9px] w-[9px]" />
            Record
          </button>
        )}
      </div>
    </header>
  );
}

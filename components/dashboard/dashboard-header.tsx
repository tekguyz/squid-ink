"use client";

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
 */

/** Shared by the two dead controls. No `--control-edge`: that token is the
 *  boundary of something you can actually operate, and neither of these is. */
const DISABLED_CONTROL =
  "border-rule-2 text-faint flex cursor-not-allowed items-center border opacity-60";

const MONO_ACTION = "font-mono text-[10px] tracking-[0.06em] uppercase";

export function DashboardHeader() {
  const phase = useRecorderStore((s) => s.phase);
  const requestRecording = useRecorderStore((s) => s.requestRecording);
  const busy = phase !== "idle" && phase !== "error";

  return (
    <header className="border-rule flex items-center gap-[14px] border-b px-[24px] pt-[18px] pb-[13px]">
      <h1 className="font-header text-ink flex-none text-[22px] font-semibold tracking-[-0.01em]">
        All notes
      </h1>

      <div
        aria-hidden
        className={`${DISABLED_CONTROL} min-w-0 max-w-[320px] flex-1 gap-[8px] px-[10px] py-[6px]`}
      >
        <span className="font-mono flex-none text-[10px]">/</span>
        <span className="font-body truncate text-[12.5px]">
          Search notes, speakers, sources
        </span>
      </div>

      <div className="ml-auto flex flex-none items-center gap-[8px]">
        <button
          type="button"
          disabled
          title="Not available yet"
          className={`${DISABLED_CONTROL} ${MONO_ACTION} px-[11px] py-[7px]`}
        >
          Import audio
        </button>
        <button
          type="button"
          onClick={requestRecording}
          disabled={busy}
          className={`${MONO_ACTION} bg-accent text-on-accent hover:bg-accent-pressed focus-visible:outline-accent flex items-center gap-[7px] px-[13px] py-[7px] font-medium focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {/* The same 9px square the HUD, the audio player and the Transcribe
              button use for a marker. Nothing here is round. */}
          <span aria-hidden className="bg-on-accent h-[9px] w-[9px]" />
          {busy ? "Recording" : "Record"}
        </button>
      </div>
    </header>
  );
}

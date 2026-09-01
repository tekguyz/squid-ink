import type { ProcessingStatus } from "@/lib/notes/view-types";

/**
 * Where a note sits in the transcription pipeline, on one line of the list.
 *
 * It exists because `'uploading'`, `'analyzing'` and `'failed'` were previously
 * indistinguishable from a finished note — the scaffold showed a title and a
 * date and nothing else, so the only way to learn that a recording had never
 * transcribed was to open it.
 *
 * Presentational and server-rendered: no state, no effect, no client boundary.
 * app/page.tsx is a Server Component and stays one.
 *
 * "Pill" is the name, not the shape. DESIGN.md's hardest rule is that nothing
 * is rounded — circles only for people — so every edge here is square and the
 * marker is the same 9px filled square the recorder HUD, the audio player and
 * the Transcribe button use.
 *
 * Colour is a token, never a literal. Only two statuses earn a hue: 'failed'
 * takes `live` (the recorder's red) because it is the one state that will not
 * change on its own, and 'completed' takes `accent`. The rest stay in the
 * neutral metadata ladder — a list where every row shouts is a list where
 * nothing does.
 */

const PILL =
  "inline-flex items-center gap-[5px] border px-[7px] py-[2px] " +
  "font-mono text-[9px] tracking-[0.14em] uppercase";

interface Look {
  label: string;
  /** The frame and the word. */
  chrome: string;
  /** The 9px square. */
  marker: string;
}

const LOOKS: Record<ProcessingStatus, Look> = {
  local: {
    label: "Local",
    chrome: "border-rule-2 text-faint",
    marker: "bg-faint",
  },
  uploading: {
    label: "Uploading",
    chrome: "border-rule-2 text-meta",
    marker: "bg-meta",
  },
  analyzing: {
    label: "Transcribing",
    chrome: "border-tint-hover bg-tint text-accent-text",
    marker: "bg-accent",
  },
  completed: {
    label: "Ready",
    chrome: "border-rule-2 text-notice",
    marker: "bg-accent",
  },
  failed: {
    label: "Failed",
    chrome: "border-live text-live",
    marker: "bg-live",
  },
};

export function StatusPill({ status }: { status: ProcessingStatus }) {
  const look = LOOKS[status];

  return (
    <span className={`${PILL} ${look.chrome}`}>
      {/* Decorative: the word beside it already says everything. */}
      <span aria-hidden className={`h-[9px] w-[9px] ${look.marker}`} />
      {look.label}
    </span>
  );
}

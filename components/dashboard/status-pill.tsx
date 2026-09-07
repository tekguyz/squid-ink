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
 * Colour is a token, never a literal. Only one status earns a hue: 'failed'
 * takes `live` (the recorder's red) because it is the one state that will not
 * change on its own. The rest stay in the neutral metadata ladder — a list
 * where every row shouts is a list where nothing does.
 *
 * `'completed'` RENDERS NOTHING — decided 2026-09-07, after the design
 * critique. A finished note is the resting state of this list, so a READY pill
 * on almost every row is ink that carries no information: it marks the normal
 * case and leaves the abnormal ones competing with it. Dropping it makes the
 * column empty by default, so a pill anywhere in it means "this note needs
 * something". Only the four unfinished states are drawn.
 *
 * `'local'` KEEPS its pill. It is not the healthy terminal state — the audio
 * has not left the device — and it is exactly the case this component was
 * built for: a note that must not look finished.
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

/** MEASURED 2026-09-01, in-page, both themes. At 9px every label is small
 *  text, so the bar is WCAG 1.4.3 AA's 4.5:1 — not the 3:1 large-text bar.
 *  `faint` came in at 2.93:1 light / 3.10:1 dark and `meta` at 4.37:1 dark;
 *  both failed and both are replaced below. `muted` and `meta-3` clear it in
 *  both themes, and the states stay told apart by word and marker rather than
 *  by lightness — which is the restraint this component was after anyway. */
const LOOKS: Record<Exclude<ProcessingStatus, "completed">, Look> = {
  local: {
    label: "Local",
    chrome: "border-rule-2 text-muted",
    marker: "bg-muted",
  },
  uploading: {
    label: "Uploading",
    chrome: "border-rule-2 text-meta-3",
    marker: "bg-meta-3",
  },
  /** `rule-2`, not `tint-hover`. Measured 2026-09-07: `tint-hover` against the
   *  `tint` fill it sat on is 1.15:1 light, so this frame was very nearly not
   *  drawn — the identical measurement CLAUDE.md § Colour already records for
   *  the accent family. `border-accent` is that section's answer for a
   *  CONTROL; a pill is not one, so it takes the decorative-frame token like
   *  every other status here. Do not darken `--tint-hover` to fix a border. */
  analyzing: {
    label: "Transcribing",
    chrome: "border-rule-2 bg-tint text-accent-text",
    marker: "bg-accent",
  },
  failed: {
    label: "Failed",
    chrome: "border-live text-live",
    marker: "bg-live",
  },
};

export function StatusPill({ status }: { status: ProcessingStatus }) {
  if (status === "completed") return null;

  const look = LOOKS[status];

  return (
    <span className={`${PILL} ${look.chrome}`}>
      {/* Decorative: the word beside it already says everything. */}
      <span aria-hidden className={`h-[9px] w-[9px] ${look.marker}`} />
      {look.label}
    </span>
  );
}

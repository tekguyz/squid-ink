import { DemoOffNote } from "@/components/demo/demo-mode";
import { FOCUS_RING, PILL } from "@/components/recorder/hud-styles";
import { RECORD_DEMO_OFF } from "@/lib/auth/demo-visitor";

/**
 * The HUD's Record for a demo visitor (issue #19): turned off, with the
 * reason. Hidden would say the app does not record; the database refuses the
 * upload either way. Moved out of record-hud.tsx unchanged (#20).
 *
 * DESIGN.md § Buttons → Disabled: the label drops to ink-disabled and the
 * frame to rule-2, never opacity. The note is the button's description, so a
 * screen reader hears why as well as that. One row, so the pill keeps its
 * drawn height inside the HUD_RESERVE strip — stacked, it measured 55px and
 * rose 7px into the feed.
 */
export function HudDemoRecord() {
  return (
    <div className={`${PILL} bg-pane border-rule-2 gap-[11px] border px-[13px] py-[9px]`}>
      {/* aria-disabled, not disabled: it stays in the Tab order, so a
          keyboard user reaches it and hears why it is off. It has no click
          handler, so pressing it does nothing. */}
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={RECORD_DEMO_OFF}
        className={`text-ink-disabled flex cursor-not-allowed items-center gap-[11px] ${FOCUS_RING}`}
      >
        <span aria-hidden="true" className="bg-ink-disabled h-[9px] w-[9px]" />
        <span className="font-header text-[13.5px] font-semibold">Record</span>
      </button>
      {/* Below sm the pill would run over the feed's footer line; the banner
          already says Demo there, and the note stays the button's description
          either way. */}
      <DemoOffNote id={RECORD_DEMO_OFF} className="max-sm:hidden" />
    </div>
  );
}

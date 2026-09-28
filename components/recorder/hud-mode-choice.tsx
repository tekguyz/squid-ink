"use client";

import { Fragment, useEffect, useId, useRef, useState } from "react";
import { GHOST_ACTION, MONO_ACTION, PILL } from "@/components/recorder/hud-styles";
import { MODE_DESCRIPTION, type RecordingMode } from "@/lib/recorder/recording-mode";

/**
 * The Meeting / Mic only choice (#20), in the HUD corner.
 *
 * Every ask for a recording on a device that can share sound opens this — the
 * HUD's Record, ⌘⇧R, and the dashboard header's Record through the dock. Only
 * the prompts for the chosen mode appear after it. A device that cannot share
 * sound never sees it.
 *
 * ONE row, no taller than the idle pill, so it stays inside the HUD_RESERVE
 * strip and covers no feed row (the layout proof opens it and measures). The
 * frame is `rule-2`, not `control-edge`: it is a container, and the buttons
 * inside carry the control edges.
 *
 * From `md` up, the row says what the focused or hovered mode records. The
 * critique found that meaning only in screen-reader text, and a sighted user
 * in an in-person meeting would pick "Meeting". Both captions share one grid
 * cell, so the row's width never jumps. Below `md` the row would run over the
 * feed's footer line, so the caption goes; each button's description still
 * carries the same words to a screen reader. "Record" names the group and is
 * never drawn — the accent square beside the caption is the Record mark.
 *
 * `notice` is the plain-words line after a Meeting share came back with no
 * sound. It is `role="status"`, not an alert: nothing failed, the user made a
 * normal choice in the browser's picker. It is the one thing allowed above the
 * row, for the moment after that choice.
 *
 * Below `sm` the row tightens further — no square, smaller gaps, ✕ for
 * Cancel — because at 390px it otherwise ran over the Dashboard's "End of
 * feed" line; the layout proof caught it.
 */
const CHOICE = `${MONO_ACTION} border-control-edge text-ink-2 hover:bg-raised border px-[9px] py-[5px] max-sm:px-[7px]`;

const MODES: { mode: RecordingMode; label: string }[] = [
  { mode: "meeting", label: "Meeting" },
  { mode: "mic", label: "Mic only" },
];

export function HudModeChoice({
  notice,
  onChoose,
  onCancel,
}: {
  notice: string | null;
  onChoose(mode: RecordingMode): void;
  onCancel(): void;
}) {
  const id = useId();
  const first = useRef<HTMLButtonElement>(null);
  const [pointed, setPointed] = useState<RecordingMode>("meeting");

  // Focus moves into the choice when it opens, so a keyboard user who pressed
  // Record or ⌘⇧R is already on it.
  useEffect(() => first.current?.focus(), []);

  // Escape closes the choice wherever focus is — a click elsewhere on the page
  // must not strand it open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <>
      {notice ? (
        <p
          role="status"
          className={`${PILL} bg-pane border-rule-2 font-body text-ink-2 max-w-sm border px-[13px] py-[9px] text-[12px] leading-[1.5]`}
        >
          {notice}
        </p>
      ) : null}
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        className={`${PILL} bg-pane border-rule-2 gap-[9px] border py-[7px] pr-[9px] pl-[13px] max-sm:gap-[6px] max-sm:pl-[9px]`}
      >
        <span id={`${id}-label`} className="sr-only">
          Record
        </span>
        <span aria-hidden="true" className="bg-accent mr-[2px] h-[9px] w-[9px] max-sm:hidden" />
        <span
          aria-hidden="true"
          className="font-body text-ink-2 mr-[4px] inline-grid text-[11.5px] max-md:hidden"
        >
          {MODES.map(({ mode }) => (
            <span
              key={mode}
              className={`col-start-1 row-start-1 ${pointed === mode ? "" : "invisible"}`}
            >
              {MODE_DESCRIPTION[mode]}
            </span>
          ))}
        </span>
        {MODES.map(({ mode, label }, index) => (
          <Fragment key={mode}>
            <button
              ref={index === 0 ? first : undefined}
              type="button"
              aria-describedby={`${id}-${mode}`}
              onClick={() => onChoose(mode)}
              onFocus={() => setPointed(mode)}
              onMouseEnter={() => setPointed(mode)}
              className={CHOICE}
            >
              {label}
            </button>
            <span id={`${id}-${mode}`} className="sr-only">
              {MODE_DESCRIPTION[mode]}
            </span>
          </Fragment>
        ))}
        <button
          type="button"
          aria-label="Cancel"
          onClick={onCancel}
          className={`${GHOST_ACTION} min-w-[24px] max-sm:px-[6px]`}
        >
          <span aria-hidden="true" className="max-sm:hidden">
            Cancel
          </span>
          <span aria-hidden="true" className="sm:hidden">
            ✕
          </span>
        </button>
      </div>
    </>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState, type Ref } from "react";
import { MONO_ACTION, PILL } from "@/components/recorder/hud-styles";

/** How long the Saved pill stays before the HUD goes back to Record. */
export const SAVED_HOLD_MS = 6_000;

/**
 * The Saved pill (#24): proof the save worked, and the way to the new note.
 *
 * It goes back to Record after SAVED_HOLD_MS, or at once on a click anywhere
 * on it. The timer stops while the pointer or keyboard focus is inside, and
 * starts over when both leave, so it never vanishes under a hand reaching for
 * "Open note". Focus counts only when the user brought it — tabbed in from
 * another element, or pressed a key inside. The HUD itself moves focus to
 * "Open note" after a Stop (use-hud-focus.ts), and that must not hold the
 * pill open forever. The timer is a plain setTimeout in an effect — nothing in the
 * render path reads a clock.
 */
export function HudSavedPill({
  noteId,
  micLost,
  onClose,
  openNoteRef,
}: {
  noteId: string;
  micLost: boolean;
  onClose(): void;
  openNoteRef: Ref<HTMLAnchorElement>;
}) {
  const [pointerIn, setPointerIn] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const held = pointerIn || focusIn;

  useEffect(() => {
    if (held) return;
    const id = setTimeout(onClose, SAVED_HOLD_MS);
    return () => clearTimeout(id);
  }, [held, onClose]);

  return (
    // The click is a shortcut for the mouse; the timer, ⌘⇧R and "Open note"
    // cover the keyboard, so the pill itself is not a control.
    <div
      role="status"
      onClick={onClose}
      onPointerEnter={() => setPointerIn(true)}
      onPointerLeave={() => setPointerIn(false)}
      onFocus={(event) => {
        if (event.relatedTarget) setFocusIn(true);
      }}
      onKeyDown={() => setFocusIn(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusIn(false);
      }}
      className={`${PILL} bg-pane border-rule-2 max-w-sm cursor-pointer items-start gap-[11px] border px-[13px] py-[6px]`}
    >
      <span aria-hidden="true" className="bg-accent mt-[4px] h-[9px] w-[9px] shrink-0" />
      <span className="flex flex-col">
        <span className="flex items-center gap-[4px]">
          <span className="font-mono text-notice text-[9.5px] tracking-[0.1em] uppercase">
            Saved
          </span>
          <span aria-hidden="true" className="font-mono text-faint text-[9.5px]">
            ·
          </span>
          <Link
            ref={openNoteRef}
            href={`/notes/${noteId}`}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
            // The negative margin keeps the 24px target without making the
            // row 24px tall: the pill must stay two lines inside the reserve.
            className={`${MONO_ACTION} text-accent-text hover:text-ink-2 -my-[5px] border border-transparent px-[8px] py-[5px]`}
          >
            Open note
          </Link>
        </span>
        {micLost ? (
          <span className="font-body text-meta text-[12px] leading-[1.35]">
            Microphone lost. Saved what was recorded.
          </span>
        ) : null}
      </span>
    </div>
  );
}

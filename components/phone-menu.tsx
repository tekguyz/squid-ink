"use client";

import type { ReactNode } from "react";
import { HUD_RESERVE } from "@/components/recorder/hud-safe-margin";

/**
 * The phone's way to the app nav (issue #91). Below 768px, All notes and a
 * note open with one 48px masthead instead of a band of links; this is the
 * "Menu" button at its right end and the sheet it opens.
 *
 * A native `popover`, not React state: it works before hydration and on a
 * server-rendered page, and the browser gives it Escape, a press outside to
 * close, and the top layer for free. The button is the only way in, so it is
 * `md:hidden` and the sheet is never open at a width where the rail shows.
 *
 * The sheet drops from the masthead's bottom edge, full width, on `rail` —
 * the sheet the nav sits on at every other width — and ends HUD_RESERVE above
 * the viewport bottom, so it never runs under the Record pill.
 *
 * No display class on the popover element itself: a `flex` there would beat
 * the browser's `display: none` on a closed popover and leave it open.
 *
 * A client component for one handler. Choosing a link inside the sheet closes
 * it: a tag, Clear or All notes lands on "/" again, where the page does not
 * remount, and a press inside a popover is not a light-dismiss — so without
 * this the sheet stayed open over the feed it had just filtered.
 */

/** The masthead's height below md. The sheet's top edge is read from it. */
export const PHONE_MASTHEAD = "48px";

export const MENU_BUTTON =
  "font-mono text-ink-2 border-control-edge hover:bg-raised focus-visible:outline-accent flex h-[32px] flex-none items-center border px-[11px] text-[11px] tracking-[0.1em] uppercase focus-visible:outline-2 focus-visible:outline-offset-1 md:hidden";

export function PhoneMenu({ id, children }: { id: string; children: ReactNode }) {
  const top = `calc(var(--demo-banner-h, 0px) + ${PHONE_MASTHEAD})`;
  return (
    <>
      <button type="button" popoverTarget={id} className={MENU_BUTTON}>
        Menu
      </button>
      <div
        id={id}
        popover="auto"
        aria-label="Menu"
        onClick={(e) => {
          if ((e.target as Element).closest("a")) e.currentTarget.hidePopover();
        }}
        style={{ top, maxHeight: `calc(100dvh - ${top} - ${HUD_RESERVE})` }}
        className="bg-rail text-ink border-rule-strong scroll-thin fixed inset-x-0 bottom-auto m-0 w-full max-w-none overflow-y-auto border-0 border-b p-0 pb-[8px]"
      >
        {children}
      </div>
    </>
  );
}

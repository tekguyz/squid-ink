"use client";

import { useActionState } from "react";
import { enterDemo, type DemoEntryState } from "@/app/notes/actions/demo";

/**
 * "Try the demo" (issue #19): a button in a form, never a link — a link is a
 * GET, and a GET is followed by previews, prefetch and crawlers (docs/adr/0001).
 * The form posts even before this island hydrates.
 *
 * Busy keeps the fill and says what is happening (DESIGN.md § Buttons → Busy).
 */

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

const MESSAGE: Record<"busy" | "failed", string> = {
  busy: "The demo is busy right now. Try again in a few minutes.",
  failed: "The demo could not start. Try again in a moment.",
};

export function DemoButton() {
  const [state, action, pending] = useActionState<DemoEntryState, FormData>(enterDemo, null);

  return (
    <form action={action} className="contents">
      <button
        type="submit"
        aria-busy={pending || undefined}
        className={`bg-accent text-on-accent hover:bg-accent-pressed font-mono inline-flex min-h-[36px] cursor-pointer items-center border border-transparent px-[15px] text-[10.5px] font-medium tracking-[0.08em] uppercase touch-manipulation ${FOCUS}`}
      >
        {pending ? "Opening the demo…" : "Try the demo"}
      </button>
      {state && (
        // order-last: the form is `contents`, so without it the message lands
        // between the two buttons in the row.
        <p role="alert" className="text-notice order-last basis-full text-[12.5px] leading-[1.5]">
          {MESSAGE[state.error]}
        </p>
      )}
    </form>
  );
}

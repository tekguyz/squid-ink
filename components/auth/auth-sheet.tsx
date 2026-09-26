import type { ReactNode } from "react";
import Link from "next/link";

/**
 * The Auth surface, App Surfaces 04: one paper sheet on the canvas, the mark
 * at the top, the current step's form in the middle, the access note pinned
 * to the bottom. Styled 2026-09-14.
 *
 * The drawing shows sign-in, create-account and recovery side by side; that is
 * a board of three states, not a layout. The app shows one state at a time.
 * Two parts of the drawing are deliberately NOT built: the six code boxes and
 * "expires in 10 minutes". Links, not codes, and links last
 * EMAIL_LINK_EXPIRY_MINUTES — docs/DECISIONS.md § Auth.
 *
 * No "use client": the server pages under /login and /auth/confirm render it,
 * and so do the client forms that switch between states.
 *
 * No fixed element and no scroll container. The page flows, so a short
 * viewport scrolls the document — and the recorder dock is hidden on these
 * routes (components/recorder/recorder-dock.tsx).
 */
export function AuthSheet({ children }: { children: ReactNode }) {
  return (
    <main className="bg-canvas text-ink flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="bg-paper border-rule flex min-h-[520px] w-full max-w-[392px] flex-col border px-[32px] py-[34px]">
        {/* The quiet way back to the landing page (issue #60): someone who
            opened /login directly can find out what the app is. A link, not a
            paragraph, and nothing else about the mark changed. */}
        <Link
          href="/"
          className={`font-header text-ink flex items-center gap-[8px] self-start text-[15px] font-bold tracking-[-0.01em] underline-offset-[3px] hover:underline ${FOCUS}`}
        >
          <span aria-hidden="true" className="bg-accent h-[18px] w-[18px]" />
          <span translate="no">Squid Ink</span>
        </Link>
        {children}
        <p className="font-mono text-muted mt-auto pt-[22px] text-[9px] leading-[1.75] tracking-[0.06em] uppercase">
          No calendar or Drive access is asked for here.
          <br />
          You connect those later.
        </p>
      </div>
    </main>
  );
}

/** The step's title block. `eyebrow` is the mono slug above the title. */
export function AuthHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="mt-[26px]">
      {eyebrow ? (
        <p className="font-mono text-muted mb-[8px] text-[9px] tracking-[0.14em] uppercase">
          {eyebrow}
        </p>
      ) : null}
      <h1 className="font-header text-ink text-[25px] leading-[1.2] font-semibold">{title}</h1>
      {children ? (
        <p className="font-body text-muted mt-[9px] text-[13px] leading-[1.6] text-pretty">
          {children}
        </p>
      ) : null}
    </header>
  );
}

/** A failure or status line: the notice block from DESIGN.md § Cards. */
export function AuthNotice({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="bg-notice-bg text-notice font-body px-[12px] py-[10px] text-[12px] leading-[1.55]">
      {children}
    </p>
  );
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1";

/** The fields stack. 11px between groups, as drawn. */
export const STACK = "mt-[20px] flex flex-col gap-[11px]";

export const LABEL = "font-mono text-muted block text-[9px] tracking-[0.12em] uppercase";

export const FIELD = `border-control-edge bg-paper text-ink font-body placeholder:text-placeholder mt-[5px] block w-full border px-[11px] py-[9px] text-[13.5px] ${FOCUS}`;

export const CHECK_ROW = "font-body text-ink-2 flex cursor-pointer items-center gap-[8px] text-[12.5px]";

export const CHECKBOX = `border-control-edge checked:border-accent checked:bg-accent size-[11px] shrink-0 cursor-pointer appearance-none border ${FOCUS}`;

/** Opacity on the disabled submit is the one place DESIGN.md allows it. */
export const PRIMARY = `bg-accent text-on-accent hover:bg-accent-pressed font-mono mt-[18px] w-full cursor-pointer py-[10px] text-[10.5px] font-medium tracking-[0.08em] uppercase disabled:cursor-progress disabled:opacity-60 ${FOCUS}`;

export const LINK = `font-body text-ink-2 hover:text-ink cursor-pointer self-start text-left text-[12.5px] underline underline-offset-[3px] ${FOCUS}`;

/** An email address inside prose, set as a figure. */
export const ADDRESS = "font-mono text-ink-2 text-[12.5px] break-all";

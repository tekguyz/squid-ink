import { getCurrentUser } from "@/lib/auth/current-user";
import { CASE_STUDY_URL, isDemoVisitor } from "@/lib/auth/demo-visitor";
import { leaveDemo } from "@/app/notes/actions/demo";

/**
 * The demo banner (issue #19; DEMO-STANDARD.md rules 6 and 7): on every page a
 * demo visitor sees, saying this is sample data, who built it, and the two
 * ways out.
 *
 * Rendered by app/layout.tsx above the page, not streamed in after it — see
 * the comment there. Nothing for anyone else.
 *
 * IN FLOW, AT THE TOP, NOT FIXED. A fixed band would sit over each screen's
 * own header. `data-demo-banner` sets --demo-banner-h in app/globals.css, and
 * every signed-in screen is `h-app` — the viewport less that band — so the
 * page still ends at the bottom of the screen and the HUD's reserved strip
 * stays where it was drawn.
 *
 * No rule under it: the tint fill is its edge. A rule-strong seam measured
 * 1.51:1 against the tint in dark theme, under the 1.8:1 a seam owes.
 *
 * One line at every width: the explanatory words drop out below sm, the two
 * actions never do.
 */

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent";

const ACTION = `font-mono text-ink inline-flex min-h-[24px] cursor-pointer items-center text-[10px] tracking-[0.06em] uppercase underline decoration-control-edge underline-offset-[3px] hover:decoration-ink ${FOCUS}`;

export async function DemoBanner() {
  if (!isDemoVisitor(await getCurrentUser())) return null;

  return (
    <aside
      data-demo-banner
      aria-label="Demo"
      className="bg-tint flex h-(--demo-banner-h) items-center gap-[14px] overflow-hidden px-[16px] whitespace-nowrap sm:px-[24px]"
    >
      <p className="flex min-w-0 items-center gap-[10px] text-[12px]">
        <span className="font-mono text-accent-text text-[10px] font-medium tracking-[0.14em] uppercase">
          Demo
        </span>
        <span className="text-ink-2 truncate max-sm:hidden">
          Sample notes, read-only. Built by <span translate="no">TEKGUYZ</span>.
        </span>
      </p>
      <div className="ml-auto flex flex-none items-center gap-[16px]">
        <a href={CASE_STUDY_URL} className={ACTION}>
          <span className="max-sm:hidden">Back to the&nbsp;</span>case study
        </a>
        {/* A form, so it works before hydration: signs out, then goes to the
            case study, never to a sign-in screen a visitor cannot use. */}
        <form action={leaveDemo}>
          <button type="submit" className={ACTION}>
            Leave demo
          </button>
        </form>
      </div>
    </aside>
  );
}

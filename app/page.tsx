import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { IdentityRail } from "@/components/dashboard/identity-rail";
import { NoteFeed } from "@/components/dashboard/note-feed";
import { HUD_RESERVE } from "@/components/recorder/hud-safe-margin";
import { getDashboardFeed } from "@/lib/notes/get-dashboard-feed";

/**
 * The Dashboard, App Surfaces 01. This replaced the throwaway scaffold that
 * stood here from 2026-08-31 to 2026-09-07.
 *
 * Two columns, not the design's three. The mockup's right-hand widget column is
 * Next up / Open actions / Sources / a drop target — a calendar integration, a
 * cross-note action query, a source taxonomy and an import path, none of which
 * exist. Rendering four empty widgets to match a drawing would be four lies
 * about what this product does.
 *
 * `new Date()` is read here rather than inside the grouping function, so the
 * bucket boundaries stay a pure function of their inputs and nothing in a
 * render path reads the clock.
 *
 * The grid is held at MIN_SURFACE_WIDTH and the page scrolls sideways under
 * it — changed 2026-09-07 after a design critique. It used to simply squeeze:
 * below 1280px the four-track rows crushed and the header's controls were cut
 * off at the viewport edge with no way to reach them. This is an INTERIM fix
 * and nothing more. No design exists for a narrow viewport — docs/DESIGN.md
 * draws one surface, at one width — so inventing a stacked or collapsed layout
 * here would be guessing at a design decision this file does not own. A real
 * responsive pass is separate future work; until then the content is reachable
 * rather than clipped, which is the whole claim being made.
 *
 * scripts/verify-layout.mjs measures 1440 and 1280 only, and its "no
 * horizontal page overflow" assertion still holds at both: the minimum equals
 * the narrower of the two. Add widths there when breakpoints actually ship.
 */

/** The width the one drawn design assumes. Below this the page scrolls; it
 *  does not reflow, because no reflowed design exists yet. */
const MIN_SURFACE_WIDTH = 1280;
export const metadata = { title: "All notes" };

export default async function Dashboard({
  searchParams,
}: {
  // A Promise in the App Router, and awaited rather than read synchronously.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // `?tag=<slug>` is the whole filter. It lives in the URL so it survives a
  // refresh and can be linked, and it is applied by the same server query that
  // builds the unfiltered feed — there is no second path to disagree with.
  const tag = (await searchParams).tag;
  const feed = await getDashboardFeed(
    new Date(),
    typeof tag === "string" ? tag : null,
  );

  return (
    <div className="scroll-thin h-dvh overflow-x-auto overflow-y-hidden">
      <div
        style={{ minWidth: MIN_SURFACE_WIDTH }}
        className="bg-canvas text-ink grid h-full grid-cols-[212px_minmax(0,1fr)]"
      >
        <IdentityRail
          email={feed.email}
          totalNotes={feed.totalNotes}
          groups={feed.groups}
          tagChips={feed.tagChips}
          activeTag={feed.activeTag}
        />

        {/* The bottom inset is the recorder HUD's corner, and it is on the column
          rather than on the scroll area inside it. Padding the scrolled content
          would only move the last row; the region itself has to end above the
          strip, or a row passes under the HUD at every other scroll position.
          The feed's right-hand count column shares the HUD's x range exactly,
          measured 2026-09-07.

          The strip is a footer rather than padding, added 2026-09-07 after a
          design critique: the reserve mechanism is right, but 72px of the same
          colour as the content — with the row rules and the scrollbar both
          stopping short of the viewport edge — reads as the page being cut off
          rather than as the list ending. Same reserved height, same guarantee,
          but the space now says something. Its one line is left-aligned
          deliberately: the HUD owns the right end of this exact band. */}
        <main className="bg-paper flex min-h-0 min-w-0 flex-col overflow-hidden">
          <DashboardHeader />
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            <NoteFeed groups={feed.groups} />
          </div>
          <footer
            style={{ height: HUD_RESERVE }}
            className="bg-canvas border-rule flex flex-none items-center border-t px-[24px]"
          >
            <p className="font-mono text-muted text-[9.5px] tracking-[0.14em] tabular-nums uppercase">
              End of feed · {feed.shownNotes}{" "}
              {feed.shownNotes === 1 ? "note" : "notes"}
              {feed.activeTag ? ` · tagged ${feed.activeTag}` : ""}
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}

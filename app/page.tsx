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
 * Narrow widths STACK — chosen by the owner 2026-09-15 over a sideways
 * scroll. From 2026-09-07 the grid was held at 1280px and the page scrolled
 * sideways under it. No drawing exists for a narrow viewport, so this layout is
 * invented, not implemented, and it follows what ordinary apps do:
 *
 *  - lg (1024) and up: the drawn two columns, unchanged.
 *  - below lg: the rail sits above the feed, reduced to the app nav and the
 *    tag filter. The account line, the two "Soon" items and the recents drop
 *    out — the recents repeat the feed directly underneath them.
 *  - below md (768): each feed row folds to two tracks (note-row.tsx) and the
 *    header wraps (dashboard-header.tsx).
 *
 * The page stays one viewport tall with the feed scrolling inside it, at every
 * width, so the footer strip still reserves the recorder HUD's corner.
 * Desktop classes are untouched; every narrow rule is a `max-lg:`/`max-md:`
 * variant beside them. scripts/verify-layout.mjs measures "/" at 1024, 768 and
 * 390 as well as 1440 and 1280.
 */

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
    <div className="h-dvh overflow-hidden">
      <div className="bg-canvas text-ink grid h-full grid-cols-[212px_minmax(0,1fr)] max-lg:grid-cols-1 max-lg:grid-rows-[auto_minmax(0,1fr)]">
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

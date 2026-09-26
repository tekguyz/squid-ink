import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { IdentityRail } from "@/components/dashboard/identity-rail";
import { NoteFeed } from "@/components/dashboard/note-feed";
import { HUD_RESERVE } from "@/components/recorder/hud-safe-margin";
import { LandingPage } from "@/components/landing/landing-page";
import Link from "next/link";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDashboardFeed } from "@/lib/notes/get-dashboard-feed";
import { feedLimit, olderHref } from "@/lib/notes/feed-page";

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

const LANDING_METADATA: Metadata = {
  title: "Squid Ink — meeting notes with no bot in the call",
  description:
    "Squid Ink records a meeting in your browser, transcribes it, and writes a summary, takeaways and action items, each one linked back to what was said.",
  openGraph: {
    title: "Squid Ink — meeting notes with no bot in the call",
    description:
      "Records in your browser. Writes the note. Every claim links back to the transcript.",
    siteName: "Squid Ink",
    type: "website",
  },
};

/** One path, two screens (issue #60). The proxy lets "/" through with no
 *  session, exactly and only "/", and this decides which screen that is. */
export async function generateMetadata(): Promise<Metadata> {
  return (await getCurrentUser()) ? { title: "All notes" } : LANDING_METADATA;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Root({ searchParams }: { searchParams: SearchParams }) {
  // No user means no RLS identity, so the Dashboard's queries would return
  // nothing or fail. The landing page reads nothing at all.
  if (!(await getCurrentUser())) return <LandingPage />;
  return dashboard(searchParams);
}

/** A plain async function rather than a component: it runs only after the
 *  session check above, and never as a sibling that could start early. */
async function dashboard(
  // A Promise in the App Router, and awaited rather than read synchronously.
  searchParams: SearchParams,
) {
  // `?tag=<slug>` is the whole filter. It lives in the URL so it survives a
  // refresh and can be linked, and it is applied by the same server query that
  // builds the unfiltered feed — there is no second path to disagree with.
  // `?show=<n>` is how many notes are on screen (lib/notes/feed-page.ts), and
  // "Show older notes" is a plain link that raises it by one page.
  const { tag, show } = await searchParams;
  const limit = feedLimit(show);
  const feed = await getDashboardFeed(
    new Date(),
    typeof tag === "string" ? tag : null,
    limit,
  );
  const onScreen = feed.groups.reduce((sum, g) => sum + g.notes.length, 0);

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
            {/* scroll={false}: the next page lands under the reader's eye, and
              the inner scroll area keeps its place across the soft navigation. */}
            {feed.hasOlder && (
              <div className="px-[24px] pt-[18px] pb-[24px]">
                <Link
                  href={olderHref(limit, feed.activeTag)}
                  scroll={false}
                  className="font-body text-ink border-control-edge hover:bg-raised focus-visible:outline-accent focus-visible:outline-2 focus-visible:outline-offset-1 inline-flex min-h-[32px] items-center border px-[12px] text-[12.5px]"
                >
                  Show older notes
                </Link>
              </div>
            )}
          </div>
          <footer
            style={{ height: HUD_RESERVE }}
            className="bg-canvas border-rule flex flex-none items-center border-t px-[24px]"
          >
            <p className="font-mono text-muted text-[9.5px] tracking-[0.14em] tabular-nums uppercase">
              {feed.hasOlder
                ? `Showing ${onScreen} of ${feed.shownNotes} notes`
                : `End of feed · ${feed.shownNotes} ${feed.shownNotes === 1 ? "note" : "notes"}`}
              {feed.activeTag ? ` · tagged ${feed.activeTag}` : ""}
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}

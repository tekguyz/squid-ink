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
 */
export default async function Dashboard() {
  const feed = await getDashboardFeed(new Date());

  return (
    <div className="bg-canvas text-ink grid h-dvh grid-cols-[212px_minmax(0,1fr)]">
      <IdentityRail
        email={feed.email}
        totalNotes={feed.totalNotes}
        groups={feed.groups}
      />

      {/* The bottom inset is the recorder HUD's corner, and it is on the column
          rather than on the scroll area inside it. Padding the scrolled content
          would only move the last row; the region itself has to end above the
          strip, or a row passes under the HUD at every other scroll position.
          The feed's right-hand count column shares the HUD's x range exactly,
          measured 2026-09-07. */}
      <main
        style={{ paddingBottom: HUD_RESERVE }}
        className="bg-paper flex min-h-0 min-w-0 flex-col overflow-hidden"
      >
        <DashboardHeader />
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <NoteFeed groups={feed.groups} />
        </div>
      </main>
    </div>
  );
}

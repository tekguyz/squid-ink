import type { ReactNode } from "react";
import type { CollectionChip } from "@/lib/notes/collections";
import { CollectionsRail } from "./collections-rail";

/**
 * The two-column frame both Collections routes render inside.
 *
 * A shared component rather than an app/collections/layout.tsx, because the
 * rail has to know WHICH collection is open in order to mark it, and a layout
 * is not told the child route's params. One server component that both pages
 * pass their own slug to is the honest version of that.
 *
 * Held at 1280px and scrolled sideways from there down to 1024px. Below
 * 1024px the rail stacks above the notes and the rule panel under them
 * (issue #23), the Dashboard's pattern in app/page.tsx, so the panel is read
 * in the same order as on a wide screen.
 *
 * Presentational and server-rendered: no state, no effect, no client boundary.
 */

export function CollectionsShell({
  chips,
  activeSlug,
  aside,
  children,
  demo = false,
}: {
  /** Issue #19: passed to the rail. */
  demo?: boolean;
  chips: CollectionChip[];
  activeSlug: string | null;
  /** The third column App Surfaces 07 draws — the auto-file rules panel. Only
   *  a single collection has one; the index renders two columns. Two whole
   *  class strings rather than an interpolated width, because Tailwind cannot
   *  build a class name at runtime. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="scroll-thin h-app overflow-x-auto overflow-y-hidden max-lg:overflow-x-hidden">
      <div
        className={`bg-canvas text-ink grid h-full min-w-[1280px] max-lg:min-w-0 max-lg:grid-cols-1 ${
          aside
            ? "grid-cols-[236px_minmax(0,1fr)_296px] max-lg:grid-rows-[auto_minmax(0,1fr)_auto]"
            : "grid-cols-[236px_minmax(0,1fr)] max-lg:grid-rows-[auto_minmax(0,1fr)]"
        }`}
      >
        <CollectionsRail chips={chips} activeSlug={activeSlug} demo={demo} />
        <main className="bg-paper flex min-h-0 min-w-0 flex-col overflow-hidden">
          {children}
        </main>
        {aside}
      </div>
    </div>
  );
}

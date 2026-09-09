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
 * Held at MIN_SURFACE_WIDTH and scrolled sideways below it, the same interim
 * treatment app/page.tsx and components/personas/personas-shell.tsx document:
 * one design exists, at one width, and inventing a narrow layout here would be
 * guessing at a decision this file does not own.
 *
 * Presentational and server-rendered: no state, no effect, no client boundary.
 */
const MIN_SURFACE_WIDTH = 1280;

export function CollectionsShell({
  chips,
  activeSlug,
  children,
}: {
  chips: CollectionChip[];
  activeSlug: string | null;
  children: ReactNode;
}) {
  return (
    <div className="scroll-thin h-dvh overflow-x-auto overflow-y-hidden">
      <div
        style={{ minWidth: MIN_SURFACE_WIDTH }}
        className="bg-canvas text-ink grid h-full grid-cols-[236px_minmax(0,1fr)]"
      >
        <CollectionsRail chips={chips} activeSlug={activeSlug} />
        <main className="bg-paper flex min-h-0 min-w-0 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}

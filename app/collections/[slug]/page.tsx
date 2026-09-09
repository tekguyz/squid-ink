import { notFound } from "next/navigation";
import { CollectionManage } from "@/components/collections/collection-manage";
import { CollectionsShell } from "@/components/collections/collections-shell";
import { NoteFeed } from "@/components/dashboard/note-feed";
import { HUD_RESERVE } from "@/components/recorder/hud-safe-margin";
import { getCollectionScreen } from "@/lib/notes/get-collection-screen";

/**
 * One collection: the notes filed in it.
 *
 * THE FEED'S OWN ROW, not a second kind of row. NoteFeed and NoteRow render
 * this list exactly as the Dashboard renders its own, and the notes are read
 * through lib/notes/read-feed-notes.ts, which the Dashboard also uses. A
 * collection is a way of looking at notes; a note that looked different in one
 * would be a different note.
 *
 * A slug that matches nothing is a 404, which is also the answer another
 * user's slug gives — RLS filters the lookup rather than refusing it, so the
 * page cannot say whether the collection exists for somebody else.
 *
 * `new Date()` is read here rather than inside the grouping function, so the
 * bucket boundaries stay a pure function of their inputs and nothing in a
 * render path reads the clock — the rule app/page.tsx states.
 */
export const metadata = { title: "Collection" };

export default async function CollectionPage({
  params,
}: {
  // A Promise in the App Router, and awaited rather than read synchronously.
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const screen = await getCollectionScreen(decodeURIComponent(slug), new Date());
  if (!screen) notFound();

  return (
    <CollectionsShell chips={screen.chips} activeSlug={screen.collection.id}>
      <header className="border-rule flex flex-col gap-[10px] border-b px-[24px] pt-[18px] pb-[14px]">
        <h1 className="font-header text-ink text-[18px] font-semibold">
          {screen.collection.name}
        </h1>
        <CollectionManage
          slug={screen.collection.id}
          name={screen.collection.name}
        />
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {screen.noteCount === 0 ? (
          <div className="flex flex-col gap-[9px] px-[24px] pt-[40px]">
            <p className="font-header text-ink text-[16px] font-semibold">
              Nothing filed here yet
            </p>
            <p className="font-body text-muted max-w-[46ch] text-[13px]">
              Open a note and add it to {screen.collection.name}. A note can be
              in several collections at once, so filing it here does not take it
              out of anything else.
            </p>
          </div>
        ) : (
          <NoteFeed groups={screen.groups} />
        )}
      </div>

      {/* The bottom inset is the recorder HUD's corner, and it is a footer
          rather than padding for the reason app/page.tsx documents: padding
          only moves the last row, so at any other scroll position a row is
          still passing underneath. */}
      <footer
        style={{ height: HUD_RESERVE }}
        className="bg-canvas border-rule flex flex-none items-center border-t px-[24px]"
      >
        <p className="font-mono text-muted text-[9.5px] tracking-[0.14em] tabular-nums uppercase">
          {screen.noteCount} {screen.noteCount === 1 ? "note" : "notes"} ·{" "}
          {screen.collection.name}
        </p>
      </footer>
    </CollectionsShell>
  );
}

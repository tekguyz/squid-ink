import { CollectionsShell } from "@/components/collections/collections-shell";
import { getCollectionsIndex } from "@/lib/notes/get-collection-screen";

/**
 * The Collections index, App Surfaces 07's Collections rail made into a
 * screen.
 *
 * It shows the rail and no note list, because no collection is open yet.
 * Choosing one is a navigation to /collections/<slug>, which is where the
 * member notes are — the same "the URL is the state" rule the tag filter
 * follows.
 *
 * There are NO auto-file rules on this screen and no place to write one. The
 * design draws WHEN/OR-WHEN conditions on a collection; that is a rule engine,
 * it is its own table and its own decision, and half of it would be worse than
 * none.
 */
export const metadata = { title: "Collections" };

export default async function CollectionsPage() {
  const { chips } = await getCollectionsIndex();

  return (
    <CollectionsShell chips={chips} activeSlug={null}>
      <div className="flex flex-col gap-[9px] px-[24px] pt-[40px]">
        <p className="font-header text-ink text-[16px] font-semibold">
          {chips.length === 0 ? "No collections yet" : "Pick a collection"}
        </p>
        <p className="font-body text-muted max-w-[46ch] text-[13px]">
          {chips.length === 0
            ? "A collection is a named place to file notes. Name one in the rail, then add notes to it from any note."
            : "Choose a collection in the rail to see the notes filed in it. A note can sit in as many collections as you file it into."}
        </p>
      </div>
    </CollectionsShell>
  );
}

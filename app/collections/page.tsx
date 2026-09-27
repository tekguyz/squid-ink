import { CollectionsShell } from "@/components/collections/collections-shell";
import { getCollectionsIndex } from "@/lib/notes/get-collection-screen";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEMO_OFF, isDemoVisitor } from "@/lib/auth/demo-visitor";

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
  // A demo visitor opens this with no collections and cannot make one: the
  // collections table is not widened for the demo (issue #19).
  const demo = isDemoVisitor(await getCurrentUser());

  return (
    <CollectionsShell chips={chips} activeSlug={null} demo={demo}>
      <div className="flex flex-col gap-[9px] px-[24px] pt-[40px]">
        <p className="font-header text-ink text-[16px] font-semibold">
          {chips.length === 0 ? "No collections yet" : "Pick a collection"}
        </p>
        <p className="font-body text-muted max-w-[46ch] text-[13px]">
          {demo
            ? `A collection is a named place to file notes. ${DEMO_OFF}`
            : chips.length === 0
            ? "A collection is a named place to file notes. Name one in the rail, then add notes to it from any note."
            : "Choose a collection in the rail to see the notes filed in it. A note can sit in as many collections as you file it into."}
        </p>
      </div>
    </CollectionsShell>
  );
}

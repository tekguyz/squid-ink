import Link from "next/link";
import { notFound } from "next/navigation";
import { CollectionsShell } from "@/components/collections/collections-shell";
import { ReviewList } from "@/components/collections/review-list";
import { RulePanel } from "@/components/collections/rule-panel";
import { HUD_RESERVE } from "@/components/recorder/hud-safe-margin";
import { getCollectionReviewScreen } from "@/lib/notes/get-collection-screen";

/**
 * One collection's needs-review view, reached from the "needed review" count
 * in the rule panel.
 *
 * A ROUTE, not a modal or an expand-in-place. The rail already makes "which
 * collection is open" a URL rather than client state; the review list follows
 * it, so it survives a refresh and the browser's Back returns to the notes.
 * The rule panel stays in its column so the count being worked down is still
 * in view.
 *
 * Per-collection by decision — docs/DECISIONS.md § Auto-file rules UI. There
 * is no dashboard-wide inbox and no banner on the note.
 */
export const metadata = { title: "Needs review" };

export default async function CollectionReviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const screen = await getCollectionReviewScreen(
    decodeURIComponent(slug),
    new Date(),
  );
  if (!screen) notFound();

  const href = `/collections/${encodeURIComponent(screen.collection.id)}`;

  return (
    <CollectionsShell
      chips={screen.chips}
      activeSlug={screen.collection.id}
      aside={<RulePanel slug={screen.collection.id} rule={screen.rule} />}
    >
      <header className="border-rule flex flex-col gap-[6px] border-b px-[24px] pt-[18px] pb-[14px]">
        <Link
          href={href}
          className="font-mono text-muted hover:text-ink focus-visible:outline-accent w-fit text-[9px] tracking-[0.14em] uppercase focus-visible:outline-2"
        >
          ← {screen.collection.name}
        </Link>
        <h1 className="font-header text-ink text-[18px] font-semibold">
          Needs review
        </h1>
        <p className="font-body text-muted max-w-[60ch] text-[12.5px]">
          Confirm files the note into {screen.collection.name}. Reject takes it
          out and counts as a false positive.
        </p>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <ReviewList
          collectionName={screen.collection.name}
          matches={screen.pending}
        />
      </div>

      {/* The recorder HUD's corner, as on the collection page. */}
      <footer
        style={{ height: HUD_RESERVE }}
        className="bg-canvas border-rule flex flex-none items-center border-t px-[24px]"
      >
        <p className="font-mono text-muted text-[9.5px] tracking-[0.14em] tabular-nums uppercase">
          {screen.pending.length} waiting · {screen.collection.name}
        </p>
      </footer>
    </CollectionsShell>
  );
}

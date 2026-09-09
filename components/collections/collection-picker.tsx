"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addNoteToCollection,
  removeNoteFromCollection,
} from "@/app/notes/actions/collections";
import type { NoteCollection } from "@/lib/notes/collections";

/**
 * What this note is filed under, and the one place a note is filed.
 *
 * THE ASSIGN ACTION, NOT A DRAG. App Surfaces 07 hints "DRAG A NOTE ONTO A
 * COLLECTION" beside its rail. A drag needs a drag source on every feed row, a
 * drop target on every rail row, a keyboard equivalent for both, and a live
 * region announcing the drop; this codebase has no drag primitive to build any
 * of that from. A field on the note that files it does the same job in one
 * round trip and works from a keyboard on the first try, so that is what
 * shipped — see components/collections/collections-rail.tsx.
 *
 * ONE CONTROL, BOTH JOBS. The field is backed by a datalist of the account's
 * collections, so an existing one is picked from a list and a new one is
 * typed — and the server resolves either the same way, because
 * addNoteToCollection creates on demand.
 *
 * MANY-TO-MANY IS VISIBLE HERE. Filing into a second collection leaves the
 * first chip in place; removing one chip leaves the others. Nothing in this
 * component treats the list as a single choice.
 *
 * OPTIMISM IS DELIBERATELY ABSENT, the same call components/tags/tag-entry.tsx
 * makes: the chip appears when the server says the row is there.
 */

const FIELD =
  "font-mono text-ink placeholder:text-placeholder w-[132px] bg-transparent text-[9px] tracking-[0.04em] uppercase outline-none";

export function CollectionPicker({
  noteId,
  collections,
  options,
}: {
  noteId: string;
  /** The collections this note is in, sorted by name. */
  collections: NoteCollection[];
  /** Every collection the account has, for the datalist. */
  options: NoteCollection[];
}) {
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const listId = useId();
  const router = useRouter();

  const run = (work: () => Promise<unknown>) => {
    startTransition(async () => {
      await work();
      router.refresh();
    });
  };

  return (
    <form
      className="flex flex-wrap items-center gap-[5px] px-[26px] pb-[13px]"
      onSubmit={(event) => {
        event.preventDefault();
        const raw = draft;
        setDraft("");
        run(() => addNoteToCollection(noteId, raw));
      }}
    >
      {/* No hue. A collection is read as a name, not picked out of a row at
          9px the way a tag is — see the colour note in
          supabase/schemas/collections.sql. */}
      {collections.map((collection) => (
        <span
          key={collection.id}
          className="bg-raised text-ink-2 font-mono flex items-center gap-[5px] px-[7px] py-[2px] text-[9px]"
        >
          {collection.name}
          <button
            type="button"
            disabled={pending}
            aria-label={`Remove from ${collection.name}`}
            className="focus-visible:outline-accent cursor-pointer leading-none focus-visible:outline-1 focus-visible:outline-offset-1"
            onClick={() =>
              run(() => removeNoteFromCollection(noteId, collection.id))
            }
          >
            ×
          </button>
        </span>
      ))}

      {/* --control-edge, because this is an interactive control and --rule-2
          is the edge of a decorative frame — see CLAUDE.md § Colour. */}
      <span className="border-control-edge focus-within:border-accent flex items-center gap-[4px] border px-[7px] py-[2px]">
        <span aria-hidden className="font-mono text-muted text-[9px]">
          ⌷
        </span>
        <input
          value={draft}
          list={listId}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="File this note in a collection"
          placeholder="add to collection"
          className={FIELD}
        />
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option.id} value={option.name} />
          ))}
        </datalist>
      </span>
    </form>
  );
}

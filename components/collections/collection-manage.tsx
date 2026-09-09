"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteCollection,
  renameCollection,
} from "@/app/notes/actions/collections";
import { normalizeCollectionName } from "@/lib/notes/collections";

/**
 * Rename and delete, for the collection that is open.
 *
 * They sit on the detail page rather than on every rail row because both act
 * on one collection and the open one is the collection the user is looking at.
 * A row with a rename field and a delete button on it is a rail that is mostly
 * controls.
 *
 * RENAME NAVIGATES. The slug is the URL segment, so a renamed collection has a
 * new address and staying put would leave the browser on a 404. The new slug
 * is computed here with the same pure function the server uses — which is why
 * lib/notes/collections.ts is client-safe.
 *
 * DELETE IS TWO-STEP, not a confirm() dialog. A native dialog blocks the whole
 * tab, cannot be styled, and is the one control on this screen that would look
 * like it came from a different application. The second click is the
 * confirmation, and the button says so.
 */

const CONTROL =
  "font-mono focus-visible:outline-accent text-[9px] tracking-[0.14em] uppercase focus-visible:outline-2 focus-visible:-outline-offset-2";

export function CollectionManage({
  slug,
  name,
}: {
  slug: string;
  name: string;
}) {
  const [draft, setDraft] = useState(name);
  const [armed, setArmed] = useState(false);
  const [taken, setTaken] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex flex-wrap items-center gap-[10px]">
      <form
        className="flex items-center gap-[6px]"
        onSubmit={(event) => {
          event.preventDefault();
          const next = normalizeCollectionName(draft);
          if (!next || next.slug === slug) return;
          startTransition(async () => {
            const outcome = await renameCollection(slug, draft);
            if (outcome === "duplicate") {
              setTaken(true);
              return;
            }
            setTaken(false);
            router.replace(`/collections/${encodeURIComponent(next.slug)}`);
            router.refresh();
          });
        }}
      >
        <span className="border-control-edge focus-within:border-accent flex items-center border px-[8px] py-[3px]">
          <input
            value={draft}
            disabled={pending}
            onChange={(event) => {
              setDraft(event.target.value);
              setTaken(false);
            }}
            aria-label="Collection name"
            className="font-mono text-ink w-[180px] bg-transparent text-[9.5px] tracking-[0.04em] uppercase outline-none"
          />
        </span>
        <button
          type="submit"
          disabled={pending}
          className={`${CONTROL} border-control-edge hover:bg-raised text-ink-2 cursor-pointer border px-[8px] py-[4px]`}
        >
          Rename
        </button>
      </form>

      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          startTransition(async () => {
            await deleteCollection(slug);
            router.replace("/collections");
            router.refresh();
          });
        }}
        className={`${CONTROL} border-control-edge hover:bg-raised text-muted cursor-pointer border px-[8px] py-[4px]`}
      >
        {armed ? "Confirm delete" : "Delete"}
      </button>

      {/* role="status", so the outcome of a write reaches a screen reader
          without moving focus. The notes line below says what delete does and
          does not touch, because "delete" over a list of notes reads like it
          takes the notes with it. */}
      <p role="status" className="font-mono text-muted text-[9px]">
        {taken
          ? "That name is already a collection."
          : armed
            ? "Deleting removes the collection, not its notes."
            : ""}
      </p>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCollection } from "@/app/notes/actions/collections";

/**
 * The one place a collection is made from the Collections screen.
 *
 * A form, not a keydown handler: Enter submits because that is what Enter does
 * in a form, and the field keeps working with a screen reader and on a phone
 * keyboard without a key-code branch — the same reasoning
 * components/tags/tag-entry.tsx states.
 *
 * OPTIMISM IS DELIBERATELY ABSENT. The row appears when the server says it is
 * there, one round trip later. A row that flickers in and then vanishes is
 * worse than one that takes a moment, and nobody is waiting on this write.
 *
 * Typing a name the account already has resolves to that collection instead of
 * failing — see createCollection. So this field has no duplicate error to
 * show, and does not pretend to.
 */
export function CollectionCreate() {
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <form
      className="px-[12px] pt-[10px] pb-[4px]"
      onSubmit={(event) => {
        event.preventDefault();
        const raw = draft;
        setDraft("");
        startTransition(async () => {
          await createCollection(raw);
          router.refresh();
        });
      }}
    >
      {/* The border is --control-edge because this IS an interactive control.
          --rule-2 is the edge of a decorative frame and would measure ~1.4:1
          here — see CLAUDE.md § Colour. */}
      <span className="border-control-edge focus-within:border-accent flex items-center gap-[5px] border px-[8px] py-[4px]">
        <span aria-hidden className="font-mono text-muted text-[9px]">
          +
        </span>
        <input
          value={draft}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="New collection name"
          placeholder="new collection"
          className="font-mono text-ink placeholder:text-placeholder w-full bg-transparent text-[9.5px] tracking-[0.04em] uppercase outline-none"
        />
      </span>
    </form>
  );
}

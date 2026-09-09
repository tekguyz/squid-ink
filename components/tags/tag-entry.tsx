"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addNoteTag, removeNoteTag } from "@/app/notes/actions/tags";
import type { NoteTag } from "@/lib/notes/tags";
import { TAG_CHIP } from "./tag-colors";

/**
 * The tag strip on Note Detail: what this note is filed under, and the one
 * place a tag is applied.
 *
 * THE "#" CUE, TRANSLATED. App Surfaces 07's rail reads "TYPE # IN A NOTE",
 * which in the drawing means typing into note prose. This app has no freeform
 * note-editing surface at all — a note is a recording, a transcript and
 * generated chunks, none of them typed into — so there is nothing to parse a
 * "#" out of. The cue becomes a field that PRINTS the "#" and takes the rest,
 * sitting with the note's own meta line. Typing a second "#" is not an error;
 * normalizeTagName strips it.
 *
 * A form, not a keydown handler: Enter submits because that is what Enter does
 * in a form, and the field keeps working with a screen reader and on a phone
 * keyboard without a key-code branch.
 *
 * OPTIMISM IS DELIBERATELY ABSENT. The badge appears when the server says the
 * row is there, which is one round trip later. A tag that flickers in and then
 * vanishes is worse than one that takes a moment, and this write is not on a
 * path anybody is waiting on.
 */

const FIELD =
  "font-mono text-ink placeholder:text-placeholder w-[110px] bg-transparent text-[9px] tracking-[0.04em] uppercase outline-none";

export function TagEntry({
  noteId,
  tags,
}: {
  noteId: string;
  tags: NoteTag[];
}) {
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
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
        run(() => addNoteTag(noteId, raw));
      }}
    >
      {tags.map((tag) => (
        <span
          key={tag.id}
          className={`${TAG_CHIP[tag.token]} font-mono flex items-center gap-[5px] px-[7px] py-[2px] text-[9px]`}
        >
          {tag.name}
          <button
            type="button"
            disabled={pending}
            aria-label={`Remove tag ${tag.name}`}
            className="focus-visible:outline-accent cursor-pointer leading-none focus-visible:outline-1 focus-visible:outline-offset-1"
            onClick={() => run(() => removeNoteTag(noteId, tag.id))}
          >
            ×
          </button>
        </span>
      ))}

      {/* The border is --control-edge because this IS an interactive control.
          --rule-2 is the edge of a decorative frame and would measure ~1.4:1
          here — see CLAUDE.md § Colour. */}
      <span className="border-control-edge focus-within:border-accent flex items-center gap-[4px] border px-[7px] py-[2px]">
        <span aria-hidden className="font-mono text-muted text-[9px]">
          #
        </span>
        <input
          value={draft}
          disabled={pending}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Add a tag"
          placeholder="add tag"
          className={FIELD}
        />
      </span>
    </form>
  );
}

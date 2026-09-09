"use client";

import { useOptimistic, useState } from "react";
import {
  addQuickAction,
  removeQuickAction,
} from "@/app/notes/actions/configure-persona";
import {
  MAX_QUICK_ACTIONS,
  MAX_QUICK_ACTION_LENGTH,
  normalizeQuickAction,
} from "@/lib/notes/persona-config";
import { usePersonaWrite } from "./use-persona-write";

/**
 * The quick-action list, with add and remove.
 *
 * THE CAP IS SHOWN, NOT DISCOVERED. `MAX_QUICK_ACTIONS of MAX_QUICK_ACTIONS`
 * is on screen from the first render, and the add control goes disabled with
 * the reason attached rather than accepting a seventh and failing behind the
 * scenes. The constant is imported from lib/notes/persona-config.ts — the same
 * one app/notes/actions/configure-persona.ts enforces — so the number a reader
 * sees and the number the endpoint holds cannot drift.
 *
 * REMOVE, NOT DELETE-THE-LENS. Nothing here removes a persona; the delete
 * decision supabase/schemas/note_chunks.sql names is still unmade. Taking a
 * string off a text[] attributes nothing and orphans nothing.
 *
 * Removal is keyed and sent BY TEXT. The action refuses an index for the
 * reason it documents — a stale list would remove its neighbour — and this
 * side matches, so what the reader clicked is what travels.
 */

const REFUSED = {
  invalid: `Type between 1 and ${MAX_QUICK_ACTION_LENGTH} characters.`,
} as const;

type Change = { kind: "add" | "remove"; value: string };

const applyChange = (current: string[], change: Change) =>
  change.kind === "add"
    ? [...current, change.value]
    : current.filter((item) => item !== change.value);

export function QuickActionsEditor({
  slug,
  actions,
}: {
  slug: string;
  actions: string[];
}) {
  const { pending, message, run } = usePersonaWrite(REFUSED);
  const [shown, apply] = useOptimistic(actions, applyChange);
  const [draft, setDraft] = useState("");

  const full = shown.length >= MAX_QUICK_ACTIONS;
  const canAdd = !full && !pending && draft.trim().length > 0;

  return (
    <div className="flex flex-col gap-[5px]">
      {shown.map((action) => (
        <div
          key={action}
          className="bg-pane flex items-center gap-[8px] px-[10px] py-[8px]"
        >
          <span className="font-body text-ink-2 min-w-0 flex-1 text-[13px]">
            {action}
          </span>
          <button
            type="button"
            disabled={pending}
            aria-label={`Remove quick action: ${action}`}
            onClick={() =>
              run(async () => {
                apply({ kind: "remove", value: action });
                return removeQuickAction(slug, action);
              })
            }
            className={[
              "border-control-edge text-ink-2 font-mono flex-none border px-[7px] py-[2px] text-[9.5px]",
              "focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2",
              pending ? "cursor-progress" : "cursor-pointer hover:bg-raised",
            ].join(" ")}
          >
            Remove
          </button>
        </div>
      ))}

      <form
        className="flex items-center gap-[6px]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canAdd) return;
          const value = draft;
          setDraft("");
          run(async () => {
            // normalizeQuickAction, not a second trim written out here: the
            // optimistic row has to be the string the action will store, or
            // the list flickers between two spellings of the same action.
            // A duplicate is NOT shown optimistically — the list is keyed by
            // its own text, so two identical rows would collide before the
            // action's "duplicate" answer ever arrived.
            const stored = normalizeQuickAction(value);
            if (stored !== null && !shown.includes(stored)) {
              apply({ kind: "add", value: stored });
            }
            return addQuickAction(slug, value);
          });
        }}
      >
        <input
          type="text"
          value={draft}
          disabled={full || pending}
          maxLength={MAX_QUICK_ACTION_LENGTH}
          aria-label="New quick action"
          placeholder={full ? "Limit reached" : "Add a quick action"}
          onChange={(event) => setDraft(event.target.value)}
          className="border-control-edge bg-paper text-ink-2 font-body placeholder:text-placeholder focus-visible:outline-accent min-w-0 flex-1 border px-[9px] py-[7px] text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!canAdd}
          className={[
            "border-control-edge text-ink-2 font-mono flex-none border px-[11px] py-[7px] text-[9.5px] tracking-[0.06em] uppercase",
            "focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2",
            canAdd
              ? "cursor-pointer hover:bg-raised"
              : "text-faint cursor-not-allowed",
          ].join(" ")}
        >
          Add
        </button>
      </form>

      <p className="font-mono text-meta text-[9px] tracking-[0.11em] uppercase">
        {/* The cap, always on screen — not a surprise on the seventh. Where
            these edits land is said ONCE, in the rail footer's "applies to /
            new notes" pair, and is not restated here. */}
        {shown.length} of {MAX_QUICK_ACTIONS}
      </p>

      {message !== null && (
        <p role="alert" className="font-mono text-notice text-[9.5px]">
          {message}
        </p>
      )}
    </div>
  );
}

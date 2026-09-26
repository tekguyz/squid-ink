"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addRuleCondition } from "@/app/notes/actions/collection-rules";
import type { ConditionKind } from "@/lib/collection-rules/rule-engine";

/**
 * "+ ADD CONDITION", and the small form it opens into.
 *
 * Its own file because components/collections/rule-panel.tsx passed the soft
 * line ceiling with it inside. The clause copy lives here and the panel reads
 * it, so a clause is phrased the same way in the list and in the form that
 * writes it.
 *
 * AN IMMEDIATE WRITE. Add is one Server Action and a refresh; there is no
 * draft to save later.
 */

export const LEAD: Record<ConditionKind, string> = {
  attendee_email_domain: "an attendee's email ends in",
  title_keyword: "the title contains",
};

export const FOCUS =
  "focus-visible:outline-accent focus-visible:outline-2 focus-visible:-outline-offset-2";
export const SMALL_BUTTON = `${FOCUS} font-mono cursor-pointer text-[9px] tracking-[0.14em] uppercase disabled:cursor-default disabled:text-ink-disabled`;

const KIND_OPTION: Record<ConditionKind, string> = {
  attendee_email_domain: "Email domain",
  title_keyword: "Title keyword",
};

export function AddCondition({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ConditionKind>("title_keyword");
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${FOCUS} border-control-edge font-mono text-meta-4 hover:bg-pane mt-[7px] w-full cursor-pointer border border-dashed px-[11px] py-[10px] text-left text-[9.5px]`}
      >
        + ADD CONDITION
      </button>
    );
  }

  const close = () => {
    setOpen(false);
    setDraft("");
    setInvalid(false);
  };

  return (
    <form
      aria-label="Add condition"
      className="border-control-edge mt-[7px] flex flex-col gap-[8px] border border-dashed px-[11px] py-[10px]"
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const outcome = await addRuleCondition(slug, kind, draft);
          if (outcome === "invalid") {
            setInvalid(true);
            return;
          }
          close();
          router.refresh();
        });
      }}
    >
      <div role="group" aria-label="Condition type" className="flex gap-[4px]">
        {(Object.keys(KIND_OPTION) as ConditionKind[]).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={kind === option}
            onClick={() => {
              setKind(option);
              setInvalid(false);
            }}
            className={`${SMALL_BUTTON} border px-[7px] py-[4px] ${
              kind === option
                ? "border-accent bg-tint text-accent-text"
                : "border-control-edge text-ink-2 hover:bg-pane"
            }`}
          >
            {KIND_OPTION[option]}
          </button>
        ))}
      </div>

      <label className="font-body text-ink-2 text-[12px]">
        {LEAD[kind]}
        <span className="border-control-edge has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-accent mt-[4px] flex border px-[8px] py-[4px]">
          <input
            autoFocus
            value={draft}
            disabled={pending}
            placeholder={kind === "attendee_email_domain" ? "acme.com" : "pilot"}
            aria-invalid={invalid}
            onChange={(event) => {
              setDraft(event.target.value);
              setInvalid(false);
            }}
            className="font-mono text-ink disabled:text-ink-disabled placeholder:text-placeholder w-full bg-transparent text-[11.5px] outline-none"
          />
        </span>
      </label>

      <div className="flex items-center gap-[6px]">
        <button
          type="submit"
          disabled={pending}
          className={`${SMALL_BUTTON} border-accent text-ink hover:bg-tint-hover border px-[8px] py-[4px]`}
        >
          Add
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={close}
          className={`${SMALL_BUTTON} border-control-edge text-muted hover:bg-pane border px-[8px] py-[4px]`}
        >
          Cancel
        </button>
      </div>

      <p role="status" className="font-mono text-muted text-[9px]">
        {invalid
          ? kind === "attendee_email_domain"
            ? "A domain needs a dot, like acme.com."
            : "Type a word or phrase."
          : ""}
      </p>
    </form>
  );
}

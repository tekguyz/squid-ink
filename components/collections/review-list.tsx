"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  confirmRuleMatch,
  rejectRuleMatch,
} from "@/app/notes/actions/collection-rules";
import type { ConditionKind } from "@/lib/collection-rules/rule-engine";
import type { PendingMatchView } from "@/lib/collection-rules/read-rules";

/**
 * The needs-review view: every match a rule found but did not file, with a
 * judgement per row.
 *
 * CONFIRM keeps the match filed — the note joins the collection.
 * REJECT un-files it and counts it as a false positive. Decided 2026-09-14,
 * docs/DECISIONS.md § Auto-file rules UI: a Reject that only cleared a flag
 * would leave the false-positive count describing nothing.
 *
 * A row answers "already handled" rather than erroring when the guarded update
 * claims nothing — another tab got there first, and the refresh that follows
 * takes the row away.
 */

const BUTTON =
  "font-mono focus-visible:outline-accent cursor-pointer border px-[9px] py-[5px] text-[9px] tracking-[0.14em] uppercase focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:cursor-default disabled:text-ink-disabled";

const WHY: Record<ConditionKind, string> = {
  attendee_email_domain: "attendee email domain",
  title_keyword: "title keyword",
};

export function ReviewList({
  collectionName,
  matches,
}: {
  collectionName: string;
  matches: PendingMatchView[];
}) {
  if (matches.length === 0) {
    return (
      <div className="flex flex-col gap-[9px] px-[24px] pt-[40px]">
        <p className="font-header text-ink text-[16px] font-semibold">
          Nothing waiting for review
        </p>
        <p className="font-body text-muted max-w-[46ch] text-[13px]">
          When a rule matches a note on its title, the note waits here before it
          is filed into {collectionName}.
        </p>
      </div>
    );
  }

  return (
    <ul>
      {matches.map((match) => (
        <ReviewRow key={match.id} match={match} />
      ))}
    </ul>
  );
}

function ReviewRow({ match }: { match: PendingMatchView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [stale, setStale] = useState(false);

  const judge = (action: (id: string) => Promise<string>) =>
    startTransition(async () => {
      const outcome = await action(match.id);
      if (outcome === "not-found") setStale(true);
      router.refresh();
    });

  return (
    <li className="border-rule-3 grid grid-cols-[74px_minmax(0,1fr)_auto] items-center gap-[14px] border-b px-[24px] py-[11px]">
      <p className="font-mono text-meta-3 text-[10px] tabular-nums">
        {match.matchedOn}
      </p>
      <div className="min-w-0">
        <Link
          href={`/notes/${match.noteId}`}
          className="font-header text-ink focus-visible:outline-accent block truncate text-[14.5px] font-semibold hover:underline focus-visible:outline-2"
        >
          {match.noteTitle}
        </Link>
        <p className="font-mono text-muted mt-[2px] text-[9.5px]">
          matched on {WHY[match.conditionKind]}
          {stale ? " · already handled" : ""}
        </p>
      </div>
      <div className="flex gap-[6px]">
        <button
          type="button"
          disabled={pending}
          aria-label={`Confirm: file ${match.noteTitle}`}
          onClick={() => judge(confirmRuleMatch)}
          className={`${BUTTON} border-accent text-ink hover:bg-tint-hover`}
        >
          Confirm
        </button>
        <button
          type="button"
          disabled={pending}
          aria-label={`Reject: un-file ${match.noteTitle}`}
          onClick={() => judge(rejectRuleMatch)}
          className={`${BUTTON} border-control-edge text-ink-2 hover:bg-raised`}
        >
          Reject
        </button>
      </div>
    </li>
  );
}

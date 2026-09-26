"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteRuleCondition } from "@/app/notes/actions/collection-rules";
import { HUD_RESERVE } from "@/components/recorder/hud-safe-margin";
import type { ConditionKind } from "@/lib/collection-rules/rule-engine";
import type { CollectionRuleView } from "@/lib/collection-rules/read-rules";
import { AddCondition, FOCUS, LEAD, SMALL_BUTTON } from "./condition-add";

/**
 * The auto-file rules column of App Surfaces 07: the clauses, the three
 * trailing-30-day counts, and the line saying what a rule can never do.
 *
 * IMMEDIATE WRITES, not a draft. Adding or removing a clause is one Server
 * Action and a refresh — there is no unsaved state here, so the Settings
 * dirty-registry pattern does not apply. The server read is the only copy of
 * the rule; nothing is mirrored into local state that could disagree with it.
 *
 * ONE CLAUSE PER CONDITION ROW. The drawing prints "the title contains pilot
 * or clinic" as one clause; storage holds one value per condition, and two
 * rows OR'd together say exactly that, so they render as two clauses rather
 * than being merged into a sentence this component would have to un-merge to
 * remove one.
 *
 * NO PROMOTE CONTROL. Which kind files unattended is DISPOSITION_BY_KIND in
 * lib/collection-rules/rule-engine.ts, and it stays an open question — see
 * docs/DECISIONS.md § Auto-file rules UI.
 */

const LABEL =
  "font-mono text-meta text-[8.5px] tracking-[0.14em] uppercase";

/** What the stored value reads as. A domain is stored bare and drawn with its
 *  "@", which is how a person recognises one. */
const shown = (kind: ConditionKind, value: string) =>
  kind === "attendee_email_domain" ? `@${value}` : value;

export function RulePanel({
  slug,
  rule,
}: {
  slug: string;
  /** null when this collection has no rule yet — the panel still renders, so
   *  "+ ADD CONDITION" is where a rule starts. */
  rule: CollectionRuleView | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const conditions = rule?.conditions ?? [];
  const counters = rule?.counters ?? {
    matched: 0,
    neededReview: 0,
    falsePositives: 0,
  };

  return (
    <aside
      aria-label="Auto-file rules"
      // THE HUD'S CORNER. This column's bottom edge is the viewport's
      // bottom-right, which the Record HUD owns (components/recorder/
      // hud-safe-margin.ts). The drawing pins the footer line to the very
      // bottom; here the whole column ends HUD_RESERVE above it instead, so
      // neither the footer nor a scrolled clause passes under the pill.
      // scripts/verify-layout.mjs failed on exactly this before the reserve.
      style={{ paddingBottom: HUD_RESERVE }}
      className="bg-dock border-rule-strong flex min-h-0 flex-col overflow-hidden border-l px-[16px] pt-[15px]"
    >
      <h2 className={LABEL}>Auto-file rules</h2>

      <div className="scroll-thin -mx-[4px] min-h-0 flex-1 overflow-y-auto px-[4px]">
        <ul className="mt-[10px] flex flex-col gap-[7px]">
          {conditions.map((condition, index) => {
            const sentence = `${LEAD[condition.kind]} ${shown(condition.kind, condition.value)}`;
            return (
              <li key={condition.id} className="bg-pane px-[11px] py-[10px]">
                <div className="flex items-center">
                  <span className="font-mono text-accent-text text-[9.5px]">
                    {index === 0 ? "WHEN" : "OR WHEN"}
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    aria-label={`Remove condition: ${sentence}`}
                    onClick={() =>
                      startTransition(async () => {
                        await deleteRuleCondition(condition.id);
                        router.refresh();
                      })
                    }
                    className={`${SMALL_BUTTON} text-meta hover:text-ink ml-auto`}
                  >
                    Remove
                  </button>
                </div>
                <p className="font-body text-ink mt-[3px] text-[12.5px] leading-[1.45]">
                  {LEAD[condition.kind]}{" "}
                  <span className="font-mono text-[11.5px] wrap-anywhere">
                    {shown(condition.kind, condition.value)}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>

        <AddCondition slug={slug} />

        <h2 className={`${LABEL} mt-[16px]`}>Applied last 30 days</h2>
        <dl className="font-mono text-meta-3 mt-[8px] text-[9.5px] leading-[1.9] tabular-nums">
          <div className="flex">
            <dt>matched</dt>
            <dd className="text-ink-stat ml-auto">
              {counters.matched} {counters.matched === 1 ? "note" : "notes"}
            </dd>
          </div>
          <div className="flex">
            <dt>
              {/* THE DRILL-IN. The count is the way into the review list, so
                  the label is the link — a separate "Review" button would be a
                  second control for the same destination. */}
              <Link
                href={`/collections/${encodeURIComponent(slug)}/review`}
                className={`${FOCUS} hover:text-ink underline decoration-dotted underline-offset-[3px]`}
              >
                needed review
              </Link>
            </dt>
            <dd className="text-ink-stat ml-auto">{counters.neededReview}</dd>
          </div>
          <div className="flex">
            <dt>false positives</dt>
            <dd className="text-ink-stat ml-auto">{counters.falsePositives}</dd>
          </div>
        </dl>
      </div>

      <p className="bg-pane font-body text-notice mt-[12px] px-[12px] py-[11px] text-[12px] leading-[1.5]">
        Rules only file notes. They never edit, re-run, or delete a note.
      </p>
    </aside>
  );
}

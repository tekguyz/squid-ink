/**
 * Reading rules and their three counts, for a server component.
 *
 * THE COUNTS ARE DERIVED HERE, EVERY TIME. There is no counter column in
 * supabase/schemas/collection_rules.sql and there must not be one — see the
 * long comment on collection_rule_matches, and countMatches in
 * lib/collection-rules/rule-engine.ts. This module reads the match records and
 * hands them to that pure function; nothing on this path can desync, because
 * there is no second number to desync from.
 *
 * THE CUTOFF IS APPLIED TWICE, on purpose. Once in the query, so a year of
 * matches is not dragged over the wire to be thrown away in JavaScript, and
 * once in countMatches, which is the definition. The query is an optimisation
 * of the rule, not the rule.
 *
 * No .eq("user_id", ...). This runs on the cookie client and RLS supplies it;
 * a redundant filter would mask an RLS failure instead of exposing it. The
 * cron's copy of these reads lives in rule-ports.ts and DOES filter, because
 * service_role bypasses RLS — that file says so.
 */

import { createClient } from "@/lib/supabase/server";
import {
  countMatches,
  windowStart,
  type ConditionKind,
  type CountableMatch,
  type MatchDisposition,
  type RuleCounters,
} from "@/lib/collection-rules/rule-engine";
import { UNTITLED_NOTE } from "@/lib/notes/group-notes-by-day";

/** One clause as a rule editor renders it. `id` is the uuid here and not a
 *  slug, because a condition has no slug and nothing routes on one — the
 *  "client never sees a uuid" rule is about identities that must survive a
 *  reseed, which a clause is not. */
export interface RuleConditionView {
  id: string;
  kind: ConditionKind;
  value: string;
  /** 0 renders as "WHEN", anything above it as "OR-WHEN". */
  position: number;
}

/** A rule with its clauses and its three trailing-30-day counts. */
export interface CollectionRuleView {
  id: string;
  /** The collection's SLUG, never its uuid — the same translation
   *  lib/notes/collections.ts does, and for the same reason. */
  collectionId: string;
  conditions: RuleConditionView[];
  counters: RuleCounters;
}

interface RuleRow {
  id: string;
  collections: { slug: string } | null;
  collection_rule_conditions: {
    id: string;
    kind: ConditionKind;
    value: string;
    position: number;
  }[];
}

interface MatchRow {
  rule_id: string;
  disposition: MatchDisposition;
  matched_at: string;
}

/**
 * Every rule this user owns, with counts.
 *
 * TWO QUERIES, never one per rule. The rules and their clauses come back in
 * one embedded select and every match in the window comes back in a second;
 * the join happens in memory. A user with twelve rules costs two round trips,
 * not thirteen — the N+1 lib/notes/collections.ts already avoids.
 */
export async function readCollectionRules(
  now: Date = new Date(),
): Promise<CollectionRuleView[]> {
  const supabase = await createClient();

  const { data: rules, error } = await supabase
    .from("collection_rules")
    .select(
      "id, collections(slug), collection_rule_conditions(id, kind, value, position)",
    );

  if (error) throw new Error(`Failed to read the rules: ${error.message}`);
  if (!rules || rules.length === 0) return [];

  const { data: matches, error: matchError } = await supabase
    .from("collection_rule_matches")
    .select("rule_id, disposition, matched_at")
    .gte("matched_at", windowStart(now).toISOString());

  if (matchError) {
    throw new Error(`Failed to read the rule matches: ${matchError.message}`);
  }

  const byRule = new Map<string, CountableMatch[]>();
  for (const row of (matches ?? []) as MatchRow[]) {
    const list = byRule.get(row.rule_id) ?? [];
    list.push({ disposition: row.disposition, matchedAt: row.matched_at });
    byRule.set(row.rule_id, list);
  }

  return (rules as unknown as RuleRow[])
    // A rule whose collection is not visible is not an error: RLS filters both
    // reads independently, and the honest answer to "a collection you cannot
    // see" is to render nothing rather than a blank row. Same reasoning
    // indexCollections states about an orphan membership.
    .filter((row): row is RuleRow & { collections: { slug: string } } =>
      Boolean(row.collections),
    )
    .map((row) => ({
      id: row.id,
      collectionId: row.collections.slug,
      conditions: (row.collection_rule_conditions ?? [])
        .slice()
        .sort((a, b) => a.position - b.position),
      counters: countMatches(byRule.get(row.id) ?? [], now),
    }));
}

/** One match waiting on a human, as the needs-review view renders it. */
export interface PendingMatchView {
  /** The match's uuid — what confirm and reject take. Same reasoning as
   *  RuleConditionView.id: a match is not an identity that survives a reseed. */
  id: string;
  noteId: string;
  noteTitle: string;
  conditionKind: ConditionKind;
  /** Pre-formatted in UTC here, never in the client, so server and browser
   *  render the same string — the reason lib/notes/group-notes-by-day.ts
   *  gives for not using toLocaleDateString. */
  matchedOn: string;
}

interface PendingRow {
  id: string;
  note_id: string;
  condition_kind: ConditionKind;
  matched_at: string;
  notes: { title: string | null } | null;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Every needs-review match on these rules, newest first.
 *
 * Takes rule ids from readCollectionRules rather than re-deriving which rules
 * a collection has — one read decides that, and this one follows it.
 *
 * NOT WINDOWED. The "needed review" count is trailing-30-day, but a match that
 * has waited 31 days still waits: dropping it from this list would leave it
 * unreachable and the note unjudged forever.
 */
export async function readPendingMatches(
  ruleIds: readonly string[],
): Promise<PendingMatchView[]> {
  if (ruleIds.length === 0) return [];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("collection_rule_matches")
    .select("id, note_id, condition_kind, matched_at, notes(title)")
    .in("rule_id", [...ruleIds])
    .eq("disposition", "needs_review")
    .order("matched_at", { ascending: false });

  if (error) throw new Error(`Failed to read the pending matches: ${error.message}`);

  return ((data ?? []) as unknown as PendingRow[]).map((row) => {
    const at = new Date(row.matched_at);
    return {
      id: row.id,
      noteId: row.note_id,
      noteTitle: row.notes?.title ?? UNTITLED_NOTE,
      conditionKind: row.condition_kind,
      matchedOn: `${String(at.getUTCDate()).padStart(2, "0")} ${MONTHS[at.getUTCMonth()]}`,
    };
  });
}

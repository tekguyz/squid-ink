"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeConditionValue,
  type ConditionKind,
} from "@/lib/collection-rules/rule-engine";
import { fileNoteIntoCollection } from "@/lib/notes/file-note";

/**
 * Writing an auto-file rule, and the two judgements a human makes about what
 * one did: confirming a needs-review match, and marking an auto-filed one a
 * false positive.
 *
 * Its own "use server". The directive is per module and app/notes/actions has
 * no shared entry point to put one in — the same reason recording.ts,
 * transcription.ts, persona.ts, tags.ts and collections.ts each carry their
 * own.
 *
 * THE AUTHENTICATED COOKIE CLIENT, never the secret key. Every read and write
 * here is confined to the caller's own rows by RLS, so acting on somebody
 * else's match matches nothing rather than erroring in a way that confirms it
 * exists. No application-level user_id FILTER — that would mask an RLS failure
 * instead of exposing it. (lib/collection-rules/rule-ports.ts DOES filter, and
 * says why: it is also reached by the cron as service_role, which bypasses RLS
 * entirely.) user_id is still SUPPLIED on insert, because it is a column the
 * row must carry and the insert policy checks it.
 *
 * NOTHING HERE RE-EVALUATES AN OLD NOTE. Writing a rule does not reach
 * backwards; rules apply forward only, from the next transcription onwards.
 * That is the same "runs once" precedent notegen set, and it is why there is
 * no backfill action in this file.
 *
 * NOTHING HERE EDITS A NOTE. The whole write surface is collection_rules,
 * collection_rule_conditions, collection_rule_matches and note_collections.
 */

export type RuleWriteOutcome =
  /** The write landed, or was already true. Both are success. */
  | "written"
  /** The condition text normalises to nothing usable — see
   *  normalizeConditionValue. A domain with no dot lands here. */
  | "invalid"
  /** Nobody is signed in, or the collection, rule or match is not this
   *  user's — or, for the two judgement actions, the match is not in the state
   *  the action moves it out of. */
  | "not-found";

type Client = Awaited<ReturnType<typeof createClient>>;

async function signedIn(supabase: Client): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Add a WHEN or OR-WHEN clause to a collection's rule, creating the rule on
 * first use.
 *
 * ONE ACTION, because a rule with no conditions matches nothing and is not
 * worth a screen of its own — the same implicit, idempotent creation
 * collections.ts and tags.ts use, and what lets the rule editor create and
 * write a clause in one step.
 *
 * `position` is what makes a clause WHEN or OR-WHEN: the first clause on a
 * rule is 0, and every later one is one past the highest already there. The
 * two names are ORDER, not two kinds of thing.
 */
export async function addRuleCondition(
  collectionSlug: string,
  kind: ConditionKind,
  raw: string,
): Promise<RuleWriteOutcome> {
  const value = normalizeConditionValue(kind, raw);
  if (!value) return "invalid";

  const supabase = await createClient();
  const userId = await signedIn(supabase);
  if (!userId) return "not-found";

  const { data: collection, error: collectionError } = await supabase
    .from("collections")
    .select("id")
    .eq("slug", collectionSlug)
    .maybeSingle<{ id: string }>();

  if (collectionError) {
    throw new Error(`Failed to read the collection: ${collectionError.message}`);
  }
  if (!collection) return "not-found";

  const ruleId = await ensureRule(supabase, userId, collection.id);

  const { data: last } = await supabase
    .from("collection_rule_conditions")
    .select("position")
    .eq("rule_id", ruleId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number }>();

  const { error } = await supabase.from("collection_rule_conditions").upsert(
    {
      user_id: userId,
      rule_id: ruleId,
      kind,
      value,
      position: last ? last.position + 1 : 0,
    },
    { onConflict: "rule_id,kind,value", ignoreDuplicates: true },
  );

  if (error) {
    throw new Error(`Failed to write the rule condition: ${error.message}`);
  }

  revalidatePath("/collections");
  revalidatePath(`/collections/${collectionSlug}`);
  return "written";
}

/** The rule on this collection, made if it is not there yet. Not exported: a
 *  rule with no conditions is not a thing a user asks for. */
async function ensureRule(
  supabase: Client,
  userId: string,
  collectionId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("collection_rules")
    .select("id")
    .eq("collection_id", collectionId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("collection_rules")
    .insert({ user_id: userId, collection_id: collectionId })
    .select("id")
    .single<{ id: string }>();

  if (error) throw new Error(`Failed to create the rule: ${error.message}`);
  return data.id;
}

/**
 * Delete one clause.
 *
 * THE MATCH RECORDS SURVIVE. collection_rule_matches hangs off the rule, not
 * off the condition, so removing a clause does not rewrite what the rule
 * already did — the counters are a history, and a history that changes when
 * you edit the rule is not one.
 */
export async function deleteRuleCondition(
  conditionId: string,
): Promise<RuleWriteOutcome> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("collection_rule_conditions")
    .delete()
    .eq("id", conditionId);

  if (error) {
    throw new Error(`Failed to delete the rule condition: ${error.message}`);
  }

  revalidatePath("/collections");
  return "written";
}

/** A match row, as both judgement actions read it. */
interface MatchRow {
  id: string;
  note_id: string;
  collection_id: string;
  user_id: string;
}

/**
 * Mark an auto-filed note a false positive.
 *
 * TWO WRITES, IN THIS ORDER. The disposition flips first, guarded on
 * `disposition = 'filed'`, and the membership is removed only if that update
 * actually claimed a row. The guard is what makes the action idempotent: a
 * double click, or two tabs, means the second update matches nothing and no
 * second delete is attempted. Flipping a 'needs_review' match is refused for
 * the same reason — it was never filed, so there is no membership to take
 * back and nothing to be wrong about.
 *
 * THE MATCH ROW IS NOT DELETED. It is the audit record the false-positive
 * counter is derived from; deleting it would decrement the count it is
 * supposed to increment.
 *
 * THE NOTE IS UNTOUCHED. One row leaves note_collections. Nothing reads or
 * writes the note's content, its chunks or its statuses.
 */
export async function markRuleMatchFalsePositive(
  matchId: string,
): Promise<RuleWriteOutcome> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("collection_rule_matches")
    .update({ disposition: "false_positive" })
    .eq("id", matchId)
    .eq("disposition", "filed")
    .select("id, note_id, collection_id, user_id")
    .maybeSingle<MatchRow>();

  if (error) throw new Error(`Failed to mark the match: ${error.message}`);
  if (!data) return "not-found";

  const { error: unfileError } = await supabase
    .from("note_collections")
    .delete()
    .eq("note_id", data.note_id)
    .eq("collection_id", data.collection_id);

  if (unfileError) {
    throw new Error(`Failed to unfile the note: ${unfileError.message}`);
  }

  revalidatePath(`/notes/${data.note_id}`);
  revalidatePath("/collections");
  return "written";
}

/**
 * Confirm a needs-review match, which files the note.
 *
 * The other half of the review state. Without it a title-keyword match would
 * queue forever and the "needed review" count would only ever go up.
 *
 * Same order as above and for the same reason: the guarded update claims the
 * row, and the membership is written only if it did. The disposition becomes
 * 'filed', which is what makes the note markable as a false positive later —
 * a confirmed match the user changes their mind about is the same judgement as
 * an automatic one they disagree with.
 */
export async function confirmRuleMatch(
  matchId: string,
): Promise<RuleWriteOutcome> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("collection_rule_matches")
    .update({ disposition: "filed" })
    .eq("id", matchId)
    .eq("disposition", "needs_review")
    .select("id, note_id, collection_id, user_id")
    .maybeSingle<MatchRow>();

  if (error) throw new Error(`Failed to confirm the match: ${error.message}`);
  if (!data) return "not-found";

  // THE SAME write path a rule and a hand-filing both take.
  const filed = await fileNoteIntoCollection(supabase, {
    noteId: data.note_id,
    collectionId: data.collection_id,
    userId: data.user_id,
  });
  if (filed === "not-found") return "not-found";

  revalidatePath(`/notes/${data.note_id}`);
  revalidatePath("/collections");
  return "written";
}

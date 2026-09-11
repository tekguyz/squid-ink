/**
 * The Supabase implementation of RulePorts — the only place in this track that
 * turns the rule engine's four ports into real queries.
 *
 * Nothing here reads an environment variable. The caller supplies the client,
 * which is what lets the cron pass a secret-key client (no session, so no RLS
 * identity) and the Server Action pass a token client (RLS supplies the owner)
 * without this file knowing the difference — the same arrangement
 * lib/notegen/notegen-ports.ts documents.
 *
 * EVERY QUERY FILTERS ON user_id, which is the standing exception CLAUDE.md
 * § Supabase -> RLS rules names and not a lapse. The cron path runs as
 * service_role, which bypasses RLS entirely, so an unfiltered read here would
 * evaluate one account's note against another account's rules and file it into
 * their collection. The Server Action path filters identically: there RLS
 * already scopes it, so the filter is defence in depth and one shared query
 * shape, exactly as lib/notegen/resolve-persona.ts does it.
 *
 * THE WRITE SURFACE IS TWO STATEMENTS. One insert into
 * collection_rule_matches, and one call into lib/notes/file-note.ts. There is
 * no statement in this file that touches notes or note_chunks, and the notes
 * read below selects two columns and writes none.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PersistableMatch, RulePorts } from "@/lib/collection-rules/apply-rules";
import type {
  CollectionRule,
  ConditionKind,
  RuleCondition,
} from "@/lib/collection-rules/rule-engine";
import { fileNoteIntoCollection } from "@/lib/notes/file-note";

/** A collection_rules row joined to its conditions, as PostgREST returns the
 *  embedded select below. */
interface RuleRow {
  id: string;
  collection_id: string;
  collection_rule_conditions: {
    kind: ConditionKind;
    value: string;
    position: number;
  }[];
}

export function createRulePorts(db: SupabaseClient): RulePorts {
  return {
    async readNote(noteId, userId) {
      // TWO COLUMNS. Not select("*"), and not a convenience wider read that a
      // later edit could quietly start writing back. A rule may read a note's
      // title and its attendees; the query is the enforcement.
      const { data, error } = await db
        .from("notes")
        .select("id, title, attendee_emails")
        .eq("id", noteId)
        .eq("user_id", userId)
        .maybeSingle<{
          id: string;
          title: string | null;
          attendee_emails: string[] | null;
        }>();

      if (error) throw new Error(`reading the note failed: ${error.message}`);
      if (!data) return null;

      return {
        id: data.id,
        title: data.title,
        attendeeEmails: data.attendee_emails,
      };
    },

    async readRules(userId) {
      // ONE read, never one per rule. The embedded select pulls every
      // condition alongside its rule, so a user with twelve rules costs one
      // round trip rather than thirteen — the same N+1 lib/notes/collections.ts
      // already avoids for memberships.
      const { data, error } = await db
        .from("collection_rules")
        .select("id, collection_id, collection_rule_conditions(kind, value, position)")
        .eq("user_id", userId);

      if (error) throw new Error(`reading the rules failed: ${error.message}`);

      return ((data ?? []) as RuleRow[]).map(
        (row): CollectionRule => ({
          id: row.id,
          collectionId: row.collection_id,
          conditions: (row.collection_rule_conditions ?? []).map(
            (condition): RuleCondition => ({
              kind: condition.kind,
              value: condition.value,
              position: condition.position,
            }),
          ),
        }),
      );
    },

    async recordMatch(match: PersistableMatch) {
      const { error } = await db.from("collection_rule_matches").insert({
        rule_id: match.ruleId,
        note_id: match.noteId,
        collection_id: match.collectionId,
        user_id: match.userId,
        condition_kind: match.conditionKind,
        disposition: match.disposition,
      });

      if (!error) return "recorded";

      // 23505 is unique (rule_id, note_id): this rule has already seen this
      // note. That is the "runs once" guarantee firing, held by the database
      // rather than by a check here, and it is a normal outcome — the cron and
      // the Server Action can both reach the same note.
      if (error.code === "23505") return "already";

      // 23503 is one of the three composite foreign keys refusing a row that
      // reaches across tenants, or pointing at a note or collection that has
      // since been deleted. Treated as "already" so a deleted collection ends
      // the evaluation quietly instead of throwing inside a deferred callback
      // nobody is watching.
      if (error.code === "23503") return "already";

      throw new Error(`recording the match failed: ${error.message}`);
    },

    async fileNote(args) {
      // THE SAME write path a user's own filing takes. Not a parallel insert.
      return fileNoteIntoCollection(db, args);
    },
  };
}

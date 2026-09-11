/**
 * Running the rules over one note, once.
 *
 * The same shape lib/notegen/generate-note.ts takes: a ports interface here, a
 * single Supabase implementation in lib/collection-rules/rule-ports.ts, and
 * two callers that share this one unit — the deferred chain in
 * app/notes/actions/transcription.ts and phase three of
 * app/api/cron/transcribe/route.ts. If both reach the same note, the loser's
 * match insert conflicts and it files nothing.
 *
 * THE WRITE SURFACE IS TWO TABLES: collection_rule_matches and, through
 * lib/notes/file-note.ts, note_collections. There is no port that can write a
 * note, a chunk, or a status column — the RulePorts interface below is the
 * whole vocabulary this module has, and reading it is how "rules only file
 * notes" is checked rather than trusted.
 *
 * RUNS ONCE PER NOTE, FORWARD ONLY. Nothing here re-evaluates an old note when
 * a rule is written or edited, matching the same "runs once" precedent
 * notegen set. The database holds the guarantee: unique (rule_id, note_id).
 */

import {
  evaluateRules,
  type CollectionRule,
  type ConditionKind,
  type EngineDisposition,
  type EvaluatableNote,
} from "@/lib/collection-rules/rule-engine";

/** A match as it is written down. */
export interface PersistableMatch {
  ruleId: string;
  noteId: string;
  collectionId: string;
  userId: string;
  conditionKind: ConditionKind;
  disposition: EngineDisposition;
}

/**
 * Everything this module is allowed to do to the database.
 *
 * Four ports, deliberately. Two reads and two writes, and neither write can
 * reach a note's content. Adding a fifth that could would be the change this
 * interface exists to make visible.
 */
export interface RulePorts {
  /** The two fields a rule may read, and no others. Returns null when the note
   *  is gone or is not this reader's to see. */
  readNote(noteId: string, userId: string): Promise<EvaluatableNote | null>;

  /** Every rule this user owns, with its conditions already attached. One
   *  read, never one per rule. */
  readRules(userId: string): Promise<CollectionRule[]>;

  /** Write the match record. "already" means unique (rule_id, note_id)
   *  refused it — this rule has already seen this note, so nothing more
   *  happens for it. */
  recordMatch(match: PersistableMatch): Promise<"recorded" | "already">;

  /** Write the membership, through lib/notes/file-note.ts. Only ever called
   *  for a match whose disposition is 'filed'. */
  fileNote(args: {
    noteId: string;
    collectionId: string;
    userId: string;
  }): Promise<"filed" | "not-found">;
}

/** What one pass did. Logged by both callers; nothing branches on it. */
export interface ApplyRulesResult {
  /** How many rules fired on this note. */
  matched: number;
  /** Of those, how many wrote a membership. */
  filed: number;
  /** Of those, how many are waiting on a human instead. */
  needsReview: number;
  /** Of those, how many this note had already been evaluated against. Above
   *  zero means the cron and the action both reached it, which is expected and
   *  is not an error. */
  alreadySeen: number;
}

const EMPTY: ApplyRulesResult = {
  matched: 0,
  filed: 0,
  needsReview: 0,
  alreadySeen: 0,
};

/**
 * Evaluate every rule this user owns against one note, and act on what fires.
 *
 * THE MATCH RECORD IS WRITTEN BEFORE THE MEMBERSHIP, and the order is the
 * whole idempotence story. `recordMatch` inserts against unique (rule_id,
 * note_id), so the first writer wins and every later one gets "already" and
 * stops. Filing first would mean a second pass re-inserting a membership the
 * user had deliberately removed — the note would come back into the collection
 * every time the cron swept it.
 *
 * A NEEDS-REVIEW MATCH WRITES NO MEMBERSHIP. That is what the review state
 * means: the rule fired, the evidence was the looser kind, and the note waits
 * for a human rather than filing itself. Confirming it is
 * `confirmRuleMatch` in app/notes/actions/collection-rules.ts.
 *
 * A user with no rules costs ONE read and returns early — this runs on every
 * transcription, and most accounts have no rules at all.
 */
export async function applyRulesToNote(
  ports: RulePorts,
  args: { noteId: string; userId: string },
): Promise<ApplyRulesResult> {
  const rules = await ports.readRules(args.userId);
  if (rules.length === 0) return EMPTY;

  const note = await ports.readNote(args.noteId, args.userId);
  if (!note) return EMPTY;

  const matches = evaluateRules(rules, note);
  const result: ApplyRulesResult = { ...EMPTY, matched: matches.length };

  for (const match of matches) {
    const written = await ports.recordMatch({
      ruleId: match.ruleId,
      noteId: note.id,
      collectionId: match.collectionId,
      userId: args.userId,
      conditionKind: match.conditionKind,
      disposition: match.disposition,
    });

    if (written === "already") {
      result.alreadySeen += 1;
      continue;
    }

    if (match.disposition === "needs_review") {
      result.needsReview += 1;
      continue;
    }

    const filed = await ports.fileNote({
      noteId: note.id,
      collectionId: match.collectionId,
      userId: args.userId,
    });
    if (filed === "filed") result.filed += 1;
  }

  return result;
}

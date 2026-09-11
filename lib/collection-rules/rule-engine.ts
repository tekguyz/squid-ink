/**
 * Auto-file rules: what a condition means, what matches, and which side of the
 * auto-file / needs-review line a match lands on.
 *
 * PURE. No I/O, no Supabase client, no clock of its own — every function that
 * needs "now" takes it as an argument, so a 30-day window is testable without
 * waiting 30 days. The same rule against the same note is the same answer in a
 * test, in the cron sweep and in the Server Action.
 *
 * CLIENT-SAFE, like lib/notes/collections.ts and lib/notes/tags.ts: a rule
 * editor is a client component and must not pull in the server Supabase
 * client.
 *
 * THIS FILE NEVER WRITES ANYTHING. It decides. lib/collection-rules/apply-rules.ts
 * is what acts on the decision, and the only rows it can reach are
 * note_collections and collection_rule_matches. Rules file notes; they never
 * edit, re-run or delete one.
 */

/** The two condition types that ship. A closed union, mirroring the check
 *  constraint on collection_rule_conditions.kind — a kind the engine cannot
 *  evaluate must not be storable, so the two definitions move together. */
export type ConditionKind = "attendee_email_domain" | "title_keyword";

/** What became of a match.
 *
 *  'filed'          the membership was written automatically.
 *  'needs_review'   matched, membership NOT written, waiting on a human.
 *  'false_positive' was 'filed', the user said it was wrong, the membership
 *                   has been removed. Only ever reached by the user's own
 *                   action, never by the engine. */
export type MatchDisposition = "filed" | "needs_review" | "false_positive";

/** What the engine can decide on its own. 'false_positive' is deliberately
 *  absent: it is a human judgement made after the fact. */
export type EngineDisposition = Extract<
  MatchDisposition,
  "filed" | "needs_review"
>;

/**
 * THE SPLIT, and it is an ASSUMPTION rather than a specification.
 *
 * The turn-07 mockup prints a "needed review" count beside "matched", so not
 * every match is silently auto-filed — but it does not say where the boundary
 * sits. This is the call made on 2026-09-11, stated here so it can be amended
 * rather than dug out of a branch:
 *
 *   attendee_email_domain -> 'filed'
 *     An address either ends in "@acme.com" or it does not. There is no
 *     partial credit and no near miss, so a domain match is evidence strong
 *     enough to act on unattended.
 *
 *   title_keyword -> 'needs_review'
 *     A keyword is a SUBSTRING test over a sentence a model wrote. "planning"
 *     matches "Q3 planning offsite" and it also matches "no planning needed".
 *     Looser evidence, more false positives, so it routes to a human instead
 *     of filing itself.
 *
 * Changing this line changes behaviour for every rule at once, which is the
 * point: the boundary is one lookup, not a condition scattered through the
 * engine.
 */
export const DISPOSITION_BY_KIND: Record<ConditionKind, EngineDisposition> = {
  attendee_email_domain: "filed",
  title_keyword: "needs_review",
};

/** One clause of a rule. `position` 0 is the WHEN clause; anything above it is
 *  an OR-WHEN clause. The two names are ORDER, not two kinds of thing. */
export interface RuleCondition {
  kind: ConditionKind;
  /** Already normalised — see normalizeConditionValue. Stored normalised so
   *  the domain comparison is an exact equality rather than a per-row
   *  transform. */
  value: string;
  position: number;
}

/** A rule as the engine evaluates it: a collection, and clauses OR'd together. */
export interface CollectionRule {
  id: string;
  collectionId: string;
  conditions: readonly RuleCondition[];
}

/** The only two note fields a rule may read. Narrow on purpose: the type is
 *  what makes "rules never touch note content" checkable rather than
 *  promised. */
export interface EvaluatableNote {
  id: string;
  title: string | null;
  /** null means "we were never told who attended", which is not the same as
   *  an empty list meaning "nobody". Both match nothing. */
  attendeeEmails: readonly string[] | null;
}

/** One rule firing on one note. */
export interface RuleMatch {
  ruleId: string;
  collectionId: string;
  /** Which kind actually fired, which is what the disposition follows from. */
  conditionKind: ConditionKind;
  disposition: EngineDisposition;
}

/** Longest condition value worth storing. A domain is short; a keyword is a
 *  word or a phrase, not a paragraph. */
const MAX_CONDITION_LENGTH = 120;

/**
 * The domain half of an email address, lower case.
 *
 * Split on the LAST "@", not the first: a local part may legally contain a
 * quoted "@", and the domain is always what follows the final one. Returns
 * null for anything with no domain half at all.
 */
export function emailDomain(raw: string): string | null {
  const at = raw.trim().lastIndexOf("@");
  if (at < 0) return null;
  const domain = raw.trim().slice(at + 1).toLowerCase();
  return domain.length === 0 ? null : domain;
}

/**
 * What the user typed for a condition, cleaned into what is stored.
 *
 * A domain is accepted in the three shapes a person actually types —
 * "acme.com", "@acme.com" and "someone@acme.com" — and all three normalise to
 * "acme.com". Accepting a whole address matters because copying one out of an
 * invite is the obvious way to build this rule.
 *
 * A keyword is lower-cased with its internal whitespace collapsed, so
 * "Q3   Planning" and "q3 planning" are the same clause rather than two.
 *
 * Returns null for anything that normalises to nothing. An empty condition is
 * not a condition, and this is the one place that decides so.
 */
export function normalizeConditionValue(
  kind: ConditionKind,
  raw: string,
): string | null {
  const collapsed = raw.replace(/\s+/g, " ").trim().slice(0, MAX_CONDITION_LENGTH);
  if (collapsed.length === 0) return null;

  if (kind === "title_keyword") return collapsed.toLowerCase();

  // A bare "@acme.com" has no local part, so emailDomain would read "acme.com"
  // from it anyway; the explicit strip is here so "@" alone is rejected rather
  // than read as an empty domain.
  const domain = collapsed.includes("@")
    ? emailDomain(collapsed)
    : collapsed.toLowerCase();

  if (!domain) return null;
  // A domain has to have a dot in it. Without this, a typo'd "acme" is stored
  // as a rule that can never match and reads as broken rather than rejected.
  return domain.includes(".") ? domain : null;
}

/** Does one clause fire on this note? */
function conditionMatches(
  condition: RuleCondition,
  note: EvaluatableNote,
): boolean {
  if (condition.kind === "attendee_email_domain") {
    // EXACT equality on the normalised domain, never endsWith. endsWith would
    // make a rule for "acme.com" fire on "notacme.com", which is precisely the
    // kind of near miss that would undermine calling a domain match strong
    // enough to auto-file.
    return (note.attendeeEmails ?? []).some(
      (email) => emailDomain(email) === condition.value,
    );
  }

  // Substring, case-insensitive. Looser than a word-boundary test on purpose:
  // a user typing "planning" expects "replanning" to count, and the looseness
  // is exactly why this kind routes to needs-review rather than filing itself.
  return (note.title ?? "").toLowerCase().includes(condition.value);
}

/**
 * Evaluate one rule against one note.
 *
 * THE CLAUSES ARE OR'd. A rule matches when ANY of its conditions matches —
 * which is what "WHEN ... OR-WHEN ..." says, and why there is no AND anywhere
 * in this file.
 *
 * When several clauses fire at once, the STRONGEST one is reported. A domain
 * match beats a keyword match, so a note that hits both auto-files rather than
 * queueing for review — the weaker evidence cannot cancel the stronger. Within
 * one kind, the lowest position wins, so the answer does not depend on the
 * order rows came back from the database.
 */
export function evaluateRule(
  rule: CollectionRule,
  note: EvaluatableNote,
): RuleMatch | null {
  const fired = rule.conditions
    .filter((condition) => conditionMatches(condition, note))
    .sort((a, b) => {
      const strength =
        Number(DISPOSITION_BY_KIND[b.kind] === "filed") -
        Number(DISPOSITION_BY_KIND[a.kind] === "filed");
      return strength !== 0 ? strength : a.position - b.position;
    });

  const winner = fired[0];
  if (!winner) return null;

  return {
    ruleId: rule.id,
    collectionId: rule.collectionId,
    conditionKind: winner.kind,
    disposition: DISPOSITION_BY_KIND[winner.kind],
  };
}

/**
 * Evaluate every rule against one note.
 *
 * MANY RULES MAY FIRE. Collections are many-to-many, so two rules filing the
 * same note into two collections are both correct and neither cancels the
 * other — there is no winner to pick, the same reasoning
 * lib/notes/collections.ts states about memberships.
 *
 * A rule with no conditions matches nothing. An empty rule is a rule the user
 * has not finished writing, and filing every note into it would be the worst
 * possible reading of "no conditions".
 */
export function evaluateRules(
  rules: readonly CollectionRule[],
  note: EvaluatableNote,
): RuleMatch[] {
  return rules
    .map((rule) => evaluateRule(rule, note))
    .filter((match): match is RuleMatch => match !== null);
}

/** The trailing window the mockup's three counts are taken over. */
export const RULE_WINDOW_DAYS = 30;

/** The oldest instant still inside the window. Takes `now` rather than reading
 *  a clock, for the reason stated at the top of this file. */
export function windowStart(now: Date): Date {
  return new Date(now.getTime() - RULE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/** A match record, reduced to the two fields a count needs. */
export interface CountableMatch {
  disposition: MatchDisposition;
  /** ISO 8601, as timestamptz comes back from PostgREST. */
  matchedAt: string;
}

/** The three numbers the mockup prints beside a rule. */
export interface RuleCounters {
  /** Every match in the window, whatever became of it. A false positive was
   *  still a match — hiding it here would make the false-positive count read
   *  as a fraction of a denominator that excludes it. */
  matched: number;
  neededReview: number;
  falsePositives: number;
}

/**
 * Derive the three counts from the match records themselves.
 *
 * DERIVED, NEVER STORED. There is no counter column in
 * supabase/schemas/collection_rules.sql and there must not be one: an integer
 * that is incremented is a second source of truth that can desync from the
 * memberships it describes, and a TRAILING window cannot be maintained by
 * incrementing at all — rows leave the window as time passes and nothing fires
 * an event when they do.
 *
 * The cutoff is exclusive of anything strictly older than the window, so a
 * match from 31 days ago is gone and one from 29 days ago is still counted.
 */
export function countMatches(
  matches: readonly CountableMatch[],
  now: Date,
): RuleCounters {
  const cutoff = windowStart(now).getTime();
  const inWindow = matches.filter(
    (match) => new Date(match.matchedAt).getTime() >= cutoff,
  );

  return {
    matched: inWindow.length,
    neededReview: inWindow.filter((m) => m.disposition === "needs_review").length,
    falsePositives: inWindow.filter((m) => m.disposition === "false_positive")
      .length,
  };
}

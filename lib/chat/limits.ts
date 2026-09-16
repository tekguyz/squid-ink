/** The two cost ceilings, as pure functions.
 *
 *  This is a solo-owner app behind session middleware, so the threat here is
 *  NOT an anonymous attacker — that door is already shut by
 *  lib/supabase/session.ts. It is a compromised session or a client bug
 *  looping requests, which is why the limits are cheap, unconditional, and
 *  checked before anything is spent.
 */

import type { ChatTurn } from "@/lib/chat/types";

/** Anything longer is refused before it reaches embedding or Claude. A large
 *  paste is the cheapest way to inflate both cost and latency. */
export const MAX_MESSAGE_CHARS = 4000;

/** Counted against chat_messages, not a new table — the table this feature
 *  already creates answers the question, and a second one would be a second
 *  thing to keep in sync. */
export const MAX_MESSAGES_PER_WINDOW = 20;
export const RATE_WINDOW_MS = 60_000;

/** DEMO MODE's two extra ceilings. Neither applies to a real account.
 *
 *  The threat model here is the opposite of the one in this file's header. A
 *  demo visitor IS an anonymous stranger — that door is deliberately open —
 *  so these are cost ceilings against ordinary use, not against an attack.
 *
 *  The numbers come from measurement, not taste. Sonnet 5 bills $2.00/MTok in,
 *  $10.00/MTok out, $2.50 cache write, $0.20 cache read. A seeded demo note
 *  gave cacheWrite=7483 (.claude/rules/chat.md), so a ten-question visit costs
 *  about $0.10: one cache write, nine cache reads, the history growing behind
 *  the breakpoint, and roughly 4,000 output tokens. Worst case is ~$0.25, when
 *  the visitor pauses longer than the 5-minute cache TTL between every single
 *  question and every turn re-pays the write.
 *
 *  The owner's ceiling for the whole feature is $1/month, so:
 */

/** Per visitor, for the life of their demo session. Ten is enough to ask real
 *  questions of three seeded notes in both scopes. */
export const DEMO_MAX_QUESTIONS_PER_VISITOR = 10;

/** Across EVERY demo visitor, per calendar month. This is the number that
 *  actually protects the card, and it is the one a visitor cannot escape by
 *  clearing cookies — which is why the per-visitor cap above is allowed to be
 *  the resettable one. 75 x $0.025 worst case is $1.88; 75 x $0.009 typical is
 *  $0.68. Raise it in this one place if the demo link ever gets busy. */
export const DEMO_MAX_QUESTIONS_PER_MONTH = 75;

/** Demo answers are generated at low effort. Output is the most expensive line
 *  on the bill at $10/MTok, and a shorter, more direct answer is arguably the
 *  better demo anyway. The owner's own chat is untouched — this is read only on
 *  the anonymous path. */
export const DEMO_EFFORT = "low" as const;

/** How much conversation Claude sees. FULL history stays in chat_messages for
 *  display regardless of what is sent. */
export const MAX_HISTORY_TURNS = 20;
export const MAX_HISTORY_TOKENS = 8000;

export function overLengthCap(text: string): boolean {
  return text.length > MAX_MESSAGE_CHARS;
}

/** Four characters to a token, the usual English rule of thumb. This bounds a
 *  budget; it does not need to be exact, and calling a real tokenizer to
 *  decide how many old turns to drop would cost more than it saves. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Newest-first truncation: take the last MAX_HISTORY_TURNS, then drop from
 *  the OLD end until the token estimate fits.
 *
 *  The newest turn is always kept. Returning an empty array would send Claude
 *  a request with no user message, which is a 400 rather than a graceful
 *  degradation. */
export function trimHistory(turns: ChatTurn[]): ChatTurn[] {
  const recent = turns.slice(-MAX_HISTORY_TURNS);
  if (recent.length === 0) return [];

  let total = recent.reduce((n, t) => n + estimateTokens(t.content), 0);
  let start = 0;
  while (total > MAX_HISTORY_TOKENS && start < recent.length - 1) {
    total -= estimateTokens(recent[start].content);
    start += 1;
  }

  // Both cuts above drop one turn at a time with no regard for role, and
  // history alternates user/assistant — so the survivor is an assistant
  // turn about half the time. The Anthropic API rejects a leading
  // assistant message outright, which surfaces to the reader as the
  // generic error banner. Drop them until a user turn leads, keeping at
  // least one message either way.
  while (start < recent.length - 1 && recent[start].role === "assistant") {
    start += 1;
  }

  return recent.slice(start);
}

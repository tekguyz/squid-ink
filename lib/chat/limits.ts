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

  return recent.slice(start);
}

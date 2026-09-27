import type { User } from "@supabase/supabase-js";

/**
 * Is this session a DEMO VISITOR (issue #19)? The one "is this a demo
 * visitor" fact the UI reads.
 *
 * `is_anonymous` is the claim public.is_anon_session() reads inside every
 * write policy, and the one app/api/chat/route.ts reads for the demo caps, so
 * the UI, the route and the database agree by construction. Read on the server
 * from getCurrentUser() and passed down; never decided in the browser.
 *
 * The UI only turns controls off. The database is what refuses the write.
 */
export function isDemoVisitor(user: Pick<User, "is_anonymous"> | null | undefined): boolean {
  return user?.is_anonymous === true;
}

/** The one sentence every turned-off write control shows. Here, in a plain
 *  module, so a server component can read it as a string — a constant
 *  imported from a "use client" file reaches the server as a reference. */
export const DEMO_OFF = "Not available in the demo.";

/** How a demo visitor is named where an account shows its email address. */
export const DEMO_VISITOR_LABEL = "Demo visitor";

/** Shared note ids, so one note explains a whole area rather than one per
 *  control (the #19 critique counted three identical notes on a note page).
 *  RECORD: the HUD pill's note; the dashboard header's Record points at it.
 *  NOTE_WRITES: one note under a note's tag and collection fields.
 *  PERSONAS: one note in the Personas pane header. */
export const RECORD_DEMO_OFF = "record-demo-off";
export const NOTE_WRITES_DEMO_OFF = "note-writes-demo-off";
export const PERSONAS_DEMO_OFF = "personas-demo-off";

/** Where "Back to the case study" and "Leave demo" go: Squid Ink's page on
 *  the studio's site, chosen by the owner 2026-09-26. Never /login — a
 *  visitor has no account to sign in with. */
export const CASE_STUDY_URL = "https://tekguyz.com/work/ai-meeting-notes";

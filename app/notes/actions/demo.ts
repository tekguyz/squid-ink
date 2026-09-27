"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rememberChoice } from "@/lib/auth/remember-choice";
import { ONBOARDED_AT_KEY } from "@/lib/onboarding/onboarding-state";
import { CASE_STUDY_URL, isDemoVisitor } from "@/lib/auth/demo-visitor";

/**
 * The demo door (issue #19, docs/adr/0001): the landing page's "Try the demo"
 * button posts here. There is no other way in — no /demo GET route exists, so
 * a link preview, a prefetch or a crawler creates nothing.
 *
 * Its own "use server", like every sibling file.
 *
 * NEVER REPLACES A SESSION. If anyone is already signed in — the owner, or a
 * visitor pressing the button again — nothing is signed in and the caller goes
 * to "/" as themselves. getUser, not getSession, so a visitor the cleanup job
 * deleted reads as no session and gets a fresh visit instead of an error.
 *
 * A VISITOR IS A FINISHED ACCOUNT. `onboarded_at` rides in on the anonymous
 * identity's metadata, so the proxy's onboarding gate lets it straight
 * through to the notes. The persona trigger skips anonymous identities, so a
 * visit writes one auth row and nothing else.
 *
 * THE HOURLY CAP is the hosted project's own rate limit on anonymous sign-ins
 * (Authentication → Rate Limits, 30 an hour, read through the management API
 * on 2026-09-26). It counts per calling IP, and the caller here is this
 * server, not the visitor. Over it, the auth server answers 429 and this says
 * the demo is busy.
 *
 * A persistent session: a visit is meant to last its seven days, so a
 * "Keep me signed in" left unchecked by an earlier sign-in on this browser
 * must not make it die when the browser closes.
 */

export type DemoEntryState = { error: "busy" | "failed" } | null;

export async function enterDemo(
  _previous: DemoEntryState,
  _form: FormData,
): Promise<DemoEntryState> {
  const supabase = await createClient({ sessionOnly: false });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  const { error } = await supabase.auth.signInAnonymously({
    options: { data: { [ONBOARDED_AT_KEY]: new Date().toISOString() } },
  });
  if (error) {
    if (error.status === 429 || error.code === "over_request_rate_limit") {
      return { error: "busy" };
    }
    console.error(`[demo] anonymous sign-in failed: ${error.message}`);
    return { error: "failed" };
  }

  await rememberChoice(true);
  redirect("/");
}

/**
 * "Leave demo", in the demo banner and in Settings. Ends the visit in this
 * browser and goes to the case study — not to /login, which a visitor cannot
 * use. The identity itself is left for the cleanup job, with its chat.
 *
 * Demo visitors only. A real account that reaches this is sent home signed in:
 * this is not a second sign-out path (that is app/notes/actions/session.ts).
 */
export async function leaveDemo(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isDemoVisitor(user)) redirect("/");

  const { error } = await supabase.auth.signOut({ scope: "local" });
  // Logged, not thrown, as in session.ts: the visitor is leaving either way.
  if (error) console.error(`[demo] sign-out failed: ${error.message}`);
  redirect(CASE_STUDY_URL);
}

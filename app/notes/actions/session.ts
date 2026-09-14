"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Ending the session — /settings' "Log me out".
 *
 * NEW with /settings (2026-09-13). Before it, nothing in app/, lib/ or
 * components/ signed a user out: the only way out was expiring the session.
 *
 * `scope: "local"`, NOT Supabase's default of "global". This repo is worked
 * from two laptops on one account (CLAUDE.md § Two machines, one repo), and a
 * global sign-out revokes every refresh token the account holds — pressing it
 * on one machine would silently sign the other one out too. "Log me out" means
 * this browser.
 *
 * The cookie client writes the cleared session cookies itself: a Server Action
 * may set cookies, which a server component may not. The proxy then sends the
 * next request to /login because there is no user.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope: "local" });
  // Logged, not thrown. The redirect still lands on /login, and a sign-out
  // that fails server-side must not leave the user staring at a stack trace
  // on a page they were trying to leave.
  if (error) console.error(`[session] sign-out failed: ${error.message}`);
  redirect("/login");
}

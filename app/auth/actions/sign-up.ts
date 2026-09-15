"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { toAuthFailure, type AuthFailure } from "@/lib/auth/auth-errors";
import { emailLinkTarget } from "@/lib/auth/email-redirect";

/**
 * Signup with email + password, confirmed by an emailed LINK.
 *
 * Until the link is used the confirm-email gate refuses a password sign-in
 * (`email_not_confirmed`, measured on the hosted project 2026-09-14). The link
 * lands on app/auth/confirm, which verifies it only when a person presses
 * Continue — never on the GET a mail scanner sends.
 *
 * Signup is public, with no invite code. That is today's default, not a locked
 * decision — docs/DECISIONS.md § Auth → Signup access model (open).
 */

const Email = z.string().trim().toLowerCase().pipe(z.email());
const SignUp = z.object({ email: Email, password: z.string().min(1).max(72) });
const Resend = z.object({ email: Email });

type Result = { ok: true } | { ok: false; failure: AuthFailure };

export async function signUpWithPassword(input: z.input<typeof SignUp>): Promise<Result> {
  const parsed = SignUp.safeParse(input);
  if (!parsed.success) return { ok: false, failure: "invalid_input" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: await emailLinkTarget() },
  });
  if (error) return { ok: false, failure: toAuthFailure(error) };

  // A session here means the hosted confirm-email gate is OFF — config drift,
  // not a feature. Refuse it rather than let an unconfirmed account in.
  if (data.session) {
    console.error("[auth] signUp returned a session: the confirm-email gate is off");
    await supabase.auth.signOut({ scope: "local" });
    return { ok: false, failure: "unknown" };
  }

  // An address that already has an account gets this same answer: Supabase
  // returns an obfuscated user and mails nothing, so the form cannot be used to
  // find out who has signed up.
  return { ok: true };
}

/** For an account that tried to sign in before confirming. Each resend is an
 *  email against the project's send limit, so the surface should not invite
 *  repeated presses. */
export async function resendConfirmationLink(input: z.input<typeof Resend>): Promise<Result> {
  const parsed = Resend.safeParse(input);
  if (!parsed.success) return { ok: false, failure: "invalid_input" };

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: await emailLinkTarget() },
  });
  return error ? { ok: false, failure: toAuthFailure(error) } : { ok: true };
}

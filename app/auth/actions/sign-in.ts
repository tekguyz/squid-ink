"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { toAuthFailure, type AuthFailure } from "@/lib/auth/auth-errors";
import { rememberChoice } from "@/lib/auth/remember-choice";
import { safeNext } from "@/lib/auth/safe-next";

/**
 * Email + password sign-in — App Surfaces 04.
 *
 * Replaced magic-link sign-in on 2026-09-14 (docs/DECISIONS.md § Auth). There
 * is no second way in: `signInWithOtp` is gone, app/auth/confirm now verifies
 * only confirmation and reset links, and
 * lib/auth/__tests__/magic-link-retired.test.ts fails if a magic link comes back.
 *
 * Server-side, not the browser client, so the session cookies are written with
 * the lifetime "Keep me signed in" chose BEFORE they reach the browser.
 *
 * An unconfirmed account gets `email_not_confirmed` back, not a session — the
 * hosted confirm-email gate refuses it (measured 2026-09-14,
 * docs/KNOWN_GAPS.md § Auth — password and email links). The surface offers a
 * new confirmation link from there, through sign-up.ts's resend.
 */

const SignIn = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  // 72: bcrypt reads no further, and Supabase refuses longer rather than
  // silently truncating.
  password: z.string().min(1).max(72),
  remember: z.boolean(),
  next: z.string().optional(),
});

export type SignInInput = z.input<typeof SignIn>;

export async function signInWithPassword(input: SignInInput): Promise<{ failure: AuthFailure }> {
  const parsed = SignIn.safeParse(input);
  if (!parsed.success) return { failure: "invalid_input" };
  const { email, password, remember, next } = parsed.data;

  const supabase = await createClient({ sessionOnly: !remember });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { failure: toAuthFailure(error) };

  await rememberChoice(remember);
  redirect(safeNext(next));
}

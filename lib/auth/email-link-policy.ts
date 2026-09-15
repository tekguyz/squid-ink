/**
 * How long an emailed confirmation or password-reset LINK stays usable, as
 * the Auth surface states it.
 *
 * Links, not codes — decided by the owner 2026-09-14 (docs/DECISIONS.md
 * § Auth). A link is the ordinary web flow; a code was only ever the drawing.
 *
 * This number is ALSO Supabase Auth config, and the two must never disagree:
 * copy that says "expires in 60 minutes" over a link that lives a day is copy
 * lying about its own link.
 *
 * - `supabase/config.toml` [auth.email] `otp_expiry` — Supabase uses the one
 *   setting for codes and links alike. lib/auth/__tests__/email-link-policy.test.ts
 *   fails when it drifts from this constant.
 * - The HOSTED project's "Email OTP expiration", set by the owner in the
 *   dashboard to 3600 on 2026-09-14. config.toml configures the local stack
 *   only and this repo never runs `config push` — docs/DEPLOYMENT.md
 *   § Supabase → Auth email.
 */
export const EMAIL_LINK_EXPIRY_SECONDS = 3600;
export const EMAIL_LINK_EXPIRY_MINUTES = EMAIL_LINK_EXPIRY_SECONDS / 60;

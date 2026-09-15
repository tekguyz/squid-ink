import type { AuthFailure } from "@/lib/auth/auth-errors";

/** Plumbing copy for the unstyled forms on /login. The designed Auth surface
 *  (App Surfaces 04) replaces the forms and owns the final words. */
export const FAILURE_TEXT: Record<AuthFailure, string> = {
  invalid_input: "Check the email address and password.",
  invalid_credentials: "That email and password do not match.",
  email_not_confirmed: "Confirm your email with the link we sent before you sign in.",
  invalid_code: "That link is wrong or has expired. Ask for a new one.",
  weak_password:
    "Use at least 8 characters, with an upper-case letter, a lower-case letter, a digit and a symbol.",
  same_password: "Choose a password you have not used on this account.",
  no_session: "Your reset link has run out. Ask for a new one.",
  email_send_limit: "Too many emails were sent recently. Try again later.",
  email_not_authorized: "This address cannot receive email from Squid Ink yet.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  signup_closed: "Squid Ink is not taking new accounts right now.",
  unknown: "Something went wrong. Try again.",
};

export const FIELD = "border border-control-edge bg-paper text-ink font-body px-3 py-2";
export const BUTTON =
  "border border-control-edge bg-accent text-on-accent font-body px-3 py-2 disabled:opacity-60";
export const LINK = "font-body text-ink-2 underline text-left";

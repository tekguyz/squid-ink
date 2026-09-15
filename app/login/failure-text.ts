import type { AuthFailure } from "@/lib/auth/auth-errors";

/** Copy for every failure the forms on /login can show. The classes those
 *  forms use live with the Auth surface in components/auth/auth-sheet.tsx. */
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

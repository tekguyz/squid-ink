/**
 * Supabase Auth errors, narrowed to the closed set the Auth surface can show.
 *
 * Keyed on `error.code`, never on `error.message`: the message is prose that
 * Supabase rewords, the code is the contract.
 *
 * `otp_expired` is what Supabase answers for a WRONG code as well as a stale
 * one — it does not tell the two apart, so neither does this.
 */
export type AuthFailure =
  | "invalid_input"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "invalid_code"
  | "weak_password"
  | "same_password"
  | "no_session"
  | "email_send_limit"
  | "email_not_authorized"
  | "rate_limited"
  | "signup_closed"
  | "unknown";

const BY_CODE: Record<string, AuthFailure> = {
  invalid_credentials: "invalid_credentials",
  email_not_confirmed: "email_not_confirmed",
  otp_expired: "invalid_code",
  weak_password: "weak_password",
  same_password: "same_password",
  session_not_found: "no_session",
  over_email_send_rate_limit: "email_send_limit",
  // The built-in mailer only sends to members of the Supabase organization.
  // docs/DECISIONS.md § Auth → Signup access model.
  email_address_not_authorized: "email_not_authorized",
  over_request_rate_limit: "rate_limited",
  // "Allow new users to sign up" switched off in the dashboard — the lever
  // for closing public signup, docs/DECISIONS.md § Auth → Signup access model.
  signup_disabled: "signup_closed",
  validation_failed: "invalid_input",
  email_address_invalid: "invalid_input",
};

export function toAuthFailure(error: { code?: string; message?: string }): AuthFailure {
  const failure = error.code ? BY_CODE[error.code] : undefined;
  if (failure) return failure;
  // Logged, because "unknown" on screen is the whole of what the user sees.
  console.error(`[auth] unmapped error ${error.code ?? "(no code)"}: ${error.message ?? ""}`);
  return "unknown";
}

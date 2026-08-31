import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Magic-link landing. Exchanges the one-time credential for a session,
 *  which @supabase/ssr writes as cookies, then sends the user on.
 *
 *  Two shapes arrive here and both have to work:
 *
 *  - `?code=` — Supabase's default email template. Its link points at
 *    /auth/v1/verify on the Supabase host, which verifies the token and
 *    bounces back here with a PKCE code. The matching verifier was written
 *    to a cookie by signInWithOtp on the login page, so the exchange runs
 *    server-side against that cookie.
 *
 *  - `?token_hash=&type=` — a custom email template built on
 *    {{ .TokenHash }}, whose link points straight at this route.
 *
 *  Only the second was handled before, so every link from the default
 *  template landed on /login?error=missing_token. Nothing caught it because
 *  no real magic link was ever clicked (docs/KNOWN_GAPS.md). */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");

  // Only same-origin paths, so the link cannot be used as an open redirect.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  // An expired or already-used link still redirects here — Supabase reports
  // the refusal on the query string rather than by failing the redirect.
  if (searchParams.get("error")) redirect("/login?error=invalid_token");

  if (!code && !tokenHash) redirect("/login?error=missing_token");

  const supabase = await createClient();

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ type: type ?? "magiclink", token_hash: tokenHash! });

  redirect(error ? "/login?error=invalid_token" : safeNext);
}

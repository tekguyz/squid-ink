import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Magic-link landing. Exchanges the one-time token for a session, which
 *  @supabase/ssr writes as cookies, then sends the user on. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");

  // Only same-origin paths, so the link cannot be used as an open redirect.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!tokenHash || !type) redirect("/login?error=missing_token");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  redirect(error ? "/login?error=invalid_token" : safeNext);
}

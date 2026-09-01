import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** A Supabase client for work that outlives the response that started it.
 *
 *  WHY THIS EXISTS. The cookie client from lib/supabase/server.ts refreshes an
 *  expired access token on demand — @supabase/auth-js does that inside
 *  __loadSession whatever `autoRefreshToken` says, because the option only
 *  governs the background timer. A refresh ROTATES the refresh token, and the
 *  replacement cookies go to that client's `setAll`, which is wrapped in a
 *  try/catch precisely because a write is impossible once the response has been
 *  sent. So a refresh inside `after()` succeeds server-side and is discarded
 *  browser-side: the user's cookie still holds the pre-rotation refresh token,
 *  GoTrue revokes it past the reuse interval, and the next request signs them
 *  out with nothing in any log saying why.
 *
 *  THE FIX is not to suppress the refresh but to remove the need for one. The
 *  caller reads the access token while the request is still open — after
 *  getUser(), which has already revalidated it against the auth server and
 *  refreshed it through a cookie store that CAN write — and hands it here. An
 *  access token is good for an hour; `after()` is capped at the platform's 300 s.
 *  The deferred work therefore never reaches expiry and never rotates anything.
 *
 *  RLS IS UNCHANGED. This is the publishable key plus the user's own JWT, so
 *  every read and write is still confined to that user's rows by the same four
 *  policies. It is emphatically NOT the secret key —
 *  app/api/cron/transcribe/route.ts remains the only shipped file that reads
 *  SUPABASE_SECRET_KEY.
 *
 *  `accessToken` rather than a global Authorization header: supabase-js builds
 *  one `fetchWithAuth` from it and gives that same fetch to BOTH the PostgREST
 *  and the Storage client, so the database calls and the audio download agree on
 *  one identity. Setting the option also replaces `client.auth` with a proxy
 *  that throws, which is the guarantee worth having here — this client cannot
 *  touch a session even by accident. Nothing in lib/transcription/ reads
 *  `.auth`, and it must stay that way. */
export function createDeferredClient(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Cannot build a deferred client: NEXT_PUBLIC_SUPABASE_URL or " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.",
    );
  }

  return createClient(url, key, { accessToken: async () => accessToken });
}

import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { isSessionOnly, withPersistence } from "@/lib/auth/session-persistence";
import { withClockSkewRetry } from "@/lib/supabase/clock-skew-retry";

/** Browser-side client. Publishable key only — never the secret key, which
 *  bypasses RLS and would be shipped to every visitor by NEXT_PUBLIC_.
 *
 *  Its own cookie adapter rather than the library's default, for one reason:
 *  the browser client refreshes the session too, and the default writes every
 *  cookie with a 400-day lifetime. Left alone, the first client-side refresh
 *  would quietly turn an unchecked "Keep me signed in" into a persistent
 *  session. lib/auth/session-persistence.ts has the rule. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // PGRST303 right after a fresh token — lib/supabase/clock-skew-retry.ts.
      global: { fetch: withClockSkewRetry() },
      cookies: {
        getAll() {
          return parseCookieHeader(document.cookie);
        },
        setAll(cookiesToSet) {
          const all = parseCookieHeader(document.cookie);
          const sessionOnly = isSessionOnly((name) => all.find((c) => c.name === name)?.value);
          for (const { name, value, options } of cookiesToSet) {
            document.cookie = serializeCookieHeader(name, value, withPersistence(options, sessionOnly));
          }
        },
      },
    },
  );
}

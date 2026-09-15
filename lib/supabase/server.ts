import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { isSessionOnly, withPersistence } from "@/lib/auth/session-persistence";

/** Server-side client for server components, server actions and route
 *  handlers. Importing next/headers makes this module server-only.
 *
 *  A new client per render — never share one across requests.
 *
 *  `sessionOnly` is passed only by the Server Actions that CREATE a session
 *  (app/auth/actions/), because the marker cookie that normally carries the
 *  choice is written after the sign-in succeeds, not before. Everyone else
 *  omits it and the marker decides — lib/auth/session-persistence.ts. */
export async function createClient(options: { sessionOnly?: boolean } = {}) {
  const cookieStore = await cookies();
  const sessionOnly =
    options.sessionOnly ?? isSessionOnly((name) => cookieStore.get(name)?.value);

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, withPersistence(options, sessionOnly));
            }
          } catch {
            // Server components cannot write cookies. The proxy
            // refreshes the session on every request, so a write that
            // lands here is already covered.
          }
        },
      },
    },
  );
}

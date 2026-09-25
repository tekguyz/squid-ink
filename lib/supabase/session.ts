import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { hasOnboarded, ONBOARDING_PATH } from "@/lib/onboarding/onboarding-state";
import { isSessionOnly, withPersistence } from "@/lib/auth/session-persistence";

/** Routes that must stay reachable without a session.
 *
 *  /login: without it sign-in is impossible. Its /login/new-password child is
 *  where a verified reset link lands; that page's action checks the session
 *  itself.
 *
 *  /auth/confirm: an emailed confirmation or reset link opens here with no
 *  session. Named exactly, not the whole /auth prefix — until 2026-09-14 the
 *  prefix was public, and a public prefix is a hole waiting for the next file
 *  someone puts under it.
 *
 *  /api/cron: a Vercel Cron invocation carries no cookies, so it has no
 *  session and would be redirected to /login. Two reasons that is fatal rather
 *  than merely wrong. Vercel cron jobs DO NOT FOLLOW REDIRECTS — the 3xx is
 *  treated as the final response and the job is recorded as complete — so the
 *  sweep would never run and nothing would say so. And the redirect answers
 *  200 with the login page, which looks like success to any caller.
 *
 *  Reachable is not unauthenticated. app/api/cron/transcribe/route.ts refuses
 *  every request that does not carry `Authorization: Bearer $CRON_SECRET`.
 *  That bearer check is the route's authorization; a user session was never
 *  the right gate for a machine caller.
 *
 *  /api/dev-login: it exists to create the session, so it cannot require one.
 *  Its own NODE_ENV check is its gate — outside development it answers 404. */
const PUBLIC_PREFIXES = ["/login", "/auth/confirm", "/api/cron", "/api/dev-login"];

/**
 * Refreshes the auth session on every matched request and writes the rotated
 * cookies onto the response that is actually returned.
 *
 * Two rules this function exists to honour:
 *
 * 1. `getUser()` is called, not `getSession()`. getSession trusts whatever is
 *    in the cookie; getUser revalidates the token against the auth server.
 * 2. The same NextResponse object the cookies were written onto is the one
 *    returned. Building a fresh response afterwards silently drops the
 *    refreshed session and logs the user out at random.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Read once, before any refresh: the marker is a session cookie, so if it is
  // on the request the browser has not been closed since the choice was made.
  const sessionOnly = isSessionOnly((name) => request.cookies.get(name)?.value);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, withPersistence(options, sessionOnly));
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!user && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.searchParams.set("next", pathname);
    return NextResponse.redirect(redirect);
  }

  // First-run gate, App Surfaces 05. Only for a signed-in PAGE request:
  // /api routes answer machines and fetches, and a redirect there would hand a
  // caller an HTML page where it expected JSON.
  if (user && !isPublic && !pathname.startsWith("/api/")) {
    const onboarded = hasOnboarded(user.user_metadata);
    const onOnboarding =
      pathname === ONBOARDING_PATH || pathname.startsWith(`${ONBOARDING_PATH}/`);

    // A completed account that types /onboarding goes to the dashboard. There
    // is nothing to redo: every choice the flow makes is changeable on
    // /personas and /settings, which are where a returning account belongs.
    if (onboarded === onOnboarding) {
      const target = request.nextUrl.clone();
      target.pathname = onboarded ? "/" : ONBOARDING_PATH;
      target.search = "";
      return redirectKeepingCookies(target, response);
    }
  }

  return response;
}

/** A redirect that still carries any session cookies rotated above. Building a
 *  bare redirect would drop them — rule 2 in the comment on updateSession. */
function redirectKeepingCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

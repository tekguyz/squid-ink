import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Routes that must stay reachable without a session, or sign-in becomes
 *  impossible. */
const PUBLIC_PREFIXES = ["/login", "/auth"];

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
            response.cookies.set(name, value, options);
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

  return response;
}

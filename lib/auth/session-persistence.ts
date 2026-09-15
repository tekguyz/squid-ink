import type { CookieOptions } from "@supabase/ssr";

/**
 * "Keep me signed in" — App Surfaces 04, which drew it as "…on this Mac".
 * The owner uses Windows; the device name was dropped 2026-09-14.
 *
 * Unchecked means the session dies when the browser closes; checked means it
 * survives. That is a cookie LIFETIME, and it is a different axis from
 * `scope: "local"` in app/notes/actions/session.ts, which decides how many
 * devices a sign-out reaches. Neither implies the other.
 *
 * @supabase/ssr writes every auth cookie with `maxAge` of 400 days and gives no
 * option to drop it: its merge puts `maxAge: DEFAULT_COOKIE_OPTIONS.maxAge`
 * AFTER the caller's `cookieOptions`. So the lifetime is removed in each
 * client's own `setAll` instead, which the library calls with the final
 * options. A cookie with neither `maxAge` nor `expires` is a session cookie.
 *
 * The choice itself lives in a marker cookie that is ALSO a session cookie.
 * Closing the browser clears both at once, so a refresh can never find the
 * auth cookies without the marker that says to keep them short.
 *
 * No marker means persistent. Every session that existed before this shipped
 * carries no marker, and none of them should start dying on browser close.
 *
 * Client-safe on purpose: lib/supabase/client.ts imports it.
 */
export const SESSION_ONLY_COOKIE = "squid-session-only";

export function isSessionOnly(read: (name: string) => string | undefined): boolean {
  return read(SESSION_ONLY_COOKIE) === "1";
}

export function withPersistence(options: CookieOptions, sessionOnly: boolean): CookieOptions {
  // `maxAge: 0` is how the library DELETES a cookie. Stripping it would turn a
  // sign-out into a cookie that lives until the browser closes.
  if (!sessionOnly || options.maxAge === 0) return options;
  const { maxAge: _maxAge, expires: _expires, ...rest } = options;
  return rest;
}

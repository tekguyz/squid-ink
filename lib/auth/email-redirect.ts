import { headers } from "next/headers";

/**
 * Where an emailed link lands: `<origin>/auth/confirm` on the origin the
 * request came from, so a link asked for on localhost opens on localhost and
 * one asked for on production opens on production.
 *
 * The origin is not trusted blindly. Supabase checks it against the redirect
 * allowlist in docs/DEPLOYMENT.md and SILENTLY substitutes the Site URL for
 * anything not on it — that file records what that cost on 2026-08-30.
 *
 * Server-only (next/headers). A Server Action POST always carries `Origin`;
 * Next.js refuses one whose Origin does not match the host.
 */
export async function emailLinkTarget(): Promise<string | undefined> {
  const origin = (await headers()).get("origin");
  return origin ? `${origin}/auth/confirm` : undefined;
}

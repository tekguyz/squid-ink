/**
 * Retries a Data API request that Supabase refused as `PGRST303 — JWT issued
 * at future`. Nothing else is retried.
 *
 * WHY. A token minted a moment ago — right after a password sign-in, a
 * password change, or a refresh — is checked by PostgREST against a cached
 * clock that can lag behind the auth server's. The fresh token then looks like
 * it was issued in the future and the read fails, which rendered the Next.js
 * error screen on production at 2026-09-14 22:40 (digest 412395248, right
 * after `POST /login/new-password`). A reload a second later worked. It is a
 * platform bug, open upstream: github.com/orgs/supabase/discussions/48123, where Supabase's
 * own advice is to retry after a short wait.
 *
 * Intermittent: 8 fresh sign-ins probed the same evening were all accepted.
 * So this is a safety net, not a cure, and it gives up after three waits
 * rather than hanging a page.
 *
 * Fixed delays, no jitter: this repo keeps Math.random out of anything a
 * render can reach, and a handful of users is no thundering herd.
 */

const DELAYS_MS = [750, 1500, 3000];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function isClockSkew(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body = await response.clone().text();
    return body.includes("PGRST303");
  } catch {
    return false;
  }
}

export function withClockSkewRetry(
  fetchImpl: typeof fetch = fetch,
  wait: (ms: number) => Promise<void> = sleep,
): typeof fetch {
  return async (input, init) => {
    let response = await fetchImpl(input, init);
    for (const delay of DELAYS_MS) {
      if (!(await isClockSkew(response))) return response;
      console.warn(`[supabase] PGRST303 JWT issued at future — retrying in ${delay} ms`);
      await wait(delay);
      response = await fetchImpl(input, init);
    }
    return response;
  };
}

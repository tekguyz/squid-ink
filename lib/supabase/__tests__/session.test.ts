// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/** No session. Every request in this file is an unauthenticated one, because
 *  that is the case the redirect rule governs. */
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
});

async function visit(pathname: string) {
  const { NextRequest } = await import("next/server");
  const { updateSession } = await import("@/lib/supabase/session");
  return updateSession(new NextRequest(`https://example.test${pathname}`));
}

describe("updateSession — signed-out redirects", () => {
  it("sends an anonymous page request to /login", async () => {
    const res = await visit("/notes/abc");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("leaves /login and /auth alone, or sign-in is impossible", async () => {
    expect((await visit("/login")).status).toBe(200);
    expect((await visit("/auth/confirm")).status).toBe(200);
  });

  it("does NOT redirect the cron route", async () => {
    // MEASURED 2026-08-31: without this, /api/cron/transcribe answered 307 to
    // /login and the sweep never ran. Vercel cron jobs DO NOT FOLLOW
    // REDIRECTS — the invocation is treated as complete on the 3xx — so this
    // would have failed silently in production forever.
    //
    // Public to the session middleware is not public: the route's own
    // CRON_SECRET bearer check is its authorization, and it must be the thing
    // that answers, not a login redirect.
    const res = await visit("/api/cron/transcribe");

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

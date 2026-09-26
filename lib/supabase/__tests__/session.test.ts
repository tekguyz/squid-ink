// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
// Imported at module scope, not inside the test body. vi.mock is hoisted above
// these, so a static import still gets the mocked @supabase/ssr, and this file
// never calls vi.resetModules() — so there is nothing a lazy import buys here.
// What it cost: next/server is a large graph, and evaluating it INSIDE the
// first test charged that one-off transform to that test's 5 s timeout.
// Measured on this machine: 151 ms alone, 368-448 ms under the full parallel
// suite. That is the only test in the suite paying a cold heavy import from
// inside its own clock, which is what made it the one that flakes.
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

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
  return updateSession(new NextRequest(`https://example.test${pathname}`));
}

describe("updateSession — signed-out redirects", () => {
  it("sends an anonymous page request to /login, with next set", async () => {
    for (const path of ["/notes/abc", "/settings"]) {
      const res = await visit(path);
      const location = new URL(res.headers.get("location") ?? "", "https://x");

      expect(res.status).toBe(307);
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe(path);
    }
  });

  it("leaves the root alone, because the landing page lives there (#60)", async () => {
    const res = await visit("/");

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("makes only the root public, not every path under it", async () => {
    // "/" as a prefix would be every path. It must match exactly.
    for (const path of ["/collections", "/personas", "/onboarding", "/notes"]) {
      expect((await visit(path)).status).toBe(307);
    }
  });

  it("leaves /login and the email-link landing alone, or sign-in is impossible", async () => {
    expect((await visit("/login")).status).toBe(200);
    expect((await visit("/login/new-password")).status).toBe(200);
    expect((await visit("/auth/confirm")).status).toBe(200);
  });

  it("makes only /auth/confirm public, not everything under /auth", async () => {
    // 2026-09-14. A public prefix is a hole waiting for the next file someone
    // puts under it.
    expect((await visit("/auth/anything-else")).status).toBe(307);
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

  it("does NOT redirect the dev-login route, which exists to create the session", async () => {
    // Its own NODE_ENV check is its gate: it answers 404 outside development.
    const res = await visit("/api/dev-login");

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";
import { SESSION_ONLY_COOKIE } from "@/lib/auth/session-persistence";

/** The proxy refreshes the session on every request. If that refresh wrote the
 *  library's 400-day lifetime, an unchecked "Keep me signed in" would last
 *  exactly until the first page load. This drives a refresh through setAll. */
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: { cookies: { setAll: (c: unknown[]) => void } },
  ) => ({
    auth: {
      getUser: async () => {
        opts.cookies.setAll([
          { name: "sb-ref-auth-token", value: "rotated", options: { path: "/", maxAge: 34560000 } },
        ]);
        return { data: { user: { id: "u1", user_metadata: { onboarded_at: "2026-09-14" } } } };
      },
    },
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

async function refreshed(cookieHeader?: string) {
  const headers = cookieHeader ? { cookie: cookieHeader } : undefined;
  const res = await updateSession(new NextRequest("https://example.test/", { headers }));
  return res.cookies.get("sb-ref-auth-token");
}

describe("updateSession — refresh keeps the sign-in's lifetime", () => {
  it("keeps a persistent session persistent", async () => {
    expect((await refreshed())?.maxAge).toBe(34560000);
  });

  it("keeps a session-only session session-only", async () => {
    const cookie = await refreshed(`${SESSION_ONLY_COOKIE}=1`);
    expect(cookie?.value).toBe("rotated");
    expect(cookie?.maxAge).toBeUndefined();
    expect(cookie?.expires).toBeUndefined();
  });
});

// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/session";

/** A signed-in user whose metadata each test sets. session.test.ts covers the
 *  signed-out rules; this file covers the first-run gate, which only applies
 *  once somebody is signed in. */
const auth = vi.hoisted(() => ({ metadata: {} as Record<string, unknown> }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "u1", user_metadata: auth.metadata } },
      }),
    },
  }),
}));

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  auth.metadata = {};
});

async function visit(pathname: string) {
  return updateSession(new NextRequest(`https://example.test${pathname}`));
}

const location = (res: Response) => new URL(res.headers.get("location") ?? "", "https://x").pathname;

describe("updateSession — first-run onboarding gate", () => {
  it("sends an account that has not onboarded from any page to /onboarding", async () => {
    for (const path of ["/", "/settings", "/notes/abc", "/personas"]) {
      const res = await visit(path);
      expect(res.status).toBe(307);
      expect(location(res)).toBe("/onboarding");
    }
  });

  it("lets that account reach /onboarding itself", async () => {
    expect((await visit("/onboarding")).status).toBe(200);
  });

  it("sends a completed account away from /onboarding to the dashboard", async () => {
    auth.metadata = { onboarded_at: "2026-09-14T10:00:00.000Z" };
    const res = await visit("/onboarding");
    expect(res.status).toBe(307);
    expect(location(res)).toBe("/");
  });

  it("leaves a completed account's ordinary pages alone", async () => {
    auth.metadata = { onboarded_at: "2026-09-14T10:00:00.000Z" };
    expect((await visit("/")).status).toBe(200);
    expect((await visit("/settings")).status).toBe(200);
  });

  it("never gates /api, /login or /auth — a redirect there breaks a fetch or sign-in", async () => {
    for (const path of ["/api/chat", "/api/cron/transcribe", "/login", "/auth/confirm"]) {
      const res = await visit(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("treats a non-string flag as not onboarded", async () => {
    auth.metadata = { onboarded_at: true };
    expect(location(await visit("/"))).toBe("/onboarding");
  });
});

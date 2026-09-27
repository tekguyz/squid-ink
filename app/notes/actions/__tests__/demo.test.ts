import { beforeEach, describe, expect, it, vi } from "vitest";
import { enterDemo, leaveDemo } from "@/app/notes/actions/demo";

/** The demo door (issue #19). The only way into demo mode: a POST behind the
 *  landing page's button, never a GET. DEMO-STANDARD.md rules 1, 2, 4 and 7. */

const state = vi.hoisted(() => ({
  user: null as { id: string; is_anonymous?: boolean } | null,
  signOuts: [] as unknown[],
  signInError: null as { status?: number; code?: string; message: string } | null,
  signIns: [] as unknown[],
  clientOptions: [] as unknown[],
  remembered: [] as boolean[],
  redirects: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    state.redirects.push(path);
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.mock("@/lib/auth/remember-choice", () => ({
  rememberChoice: async (remember: boolean) => void state.remembered.push(remember),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async (options?: unknown) => {
    state.clientOptions.push(options);
    return {
      auth: {
        getUser: async () => ({ data: { user: state.user }, error: null }),
        signOut: async (attrs: unknown) => {
          state.signOuts.push(attrs);
          return { error: null };
        },
        signInAnonymously: async (attrs: unknown) => {
          state.signIns.push(attrs);
          return { data: {}, error: state.signInError };
        },
      },
    };
  },
}));

beforeEach(() => {
  state.user = null;
  state.signInError = null;
  state.signIns = [];
  state.signOuts = [];
  state.clientOptions = [];
  state.remembered = [];
  state.redirects = [];
});

const press = () => enterDemo(null, new FormData());

describe("enterDemo", () => {
  it("signs a visitor in anonymously, already onboarded, and opens the dashboard", async () => {
    await expect(press()).rejects.toThrow("NEXT_REDIRECT");

    expect(state.signIns).toHaveLength(1);
    const { options } = state.signIns[0] as { options: { data: Record<string, unknown> } };
    // The onboarding gate reads this flag; without it a visitor lands on
    // /onboarding instead of the notes.
    expect(typeof options.data.onboarded_at).toBe("string");
    expect(state.redirects).toEqual(["/"]);
  });

  it("keeps the visit across a browser restart, for the week it lives", async () => {
    await expect(press()).rejects.toThrow("NEXT_REDIRECT");

    // A persistent session, whatever "Keep me signed in" a previous sign-in on
    // this browser left behind.
    expect(state.clientOptions[0]).toEqual({ sessionOnly: false });
    expect(state.remembered).toEqual([true]);
  });

  it("never replaces a session that already exists", async () => {
    state.user = { id: "the-owner" };
    await expect(press()).rejects.toThrow("NEXT_REDIRECT");

    expect(state.signIns).toHaveLength(0);
    expect(state.remembered).toHaveLength(0);
    expect(state.redirects).toEqual(["/"]);
  });

  it("says the demo is busy over the hourly cap, and signs nobody in", async () => {
    state.signInError = { status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" };

    await expect(press()).resolves.toEqual({ error: "busy" });
    expect(state.redirects).toHaveLength(0);
    expect(state.remembered).toHaveLength(0);
  });

  it("reports any other failure without redirecting", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.signInError = { status: 500, message: "boom" };

    await expect(press()).resolves.toEqual({ error: "failed" });
    expect(state.redirects).toHaveLength(0);
  });
});

describe("leaveDemo", () => {
  it("signs a visitor out of this browser and goes to the case study", async () => {
    state.user = { id: "visitor-1", is_anonymous: true };
    await expect(leaveDemo()).rejects.toThrow("NEXT_REDIRECT");

    expect(state.signOuts).toEqual([{ scope: "local" }]);
    // Not /login: a visitor has no account to sign back in with.
    expect(state.redirects).toEqual(["https://tekguyz.com/work/ai-meeting-notes"]);
  });

  it("never signs out a real account", async () => {
    state.user = { id: "the-owner", is_anonymous: false };
    await expect(leaveDemo()).rejects.toThrow("NEXT_REDIRECT");

    expect(state.signOuts).toHaveLength(0);
    expect(state.redirects).toEqual(["/"]);
  });
});

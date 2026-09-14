import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeOnboarding } from "@/app/notes/actions/onboarding";

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  error: null as { message: string } | null,
  updates: [] as unknown[],
  redirects: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    state.redirects.push(path);
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
      updateUser: async (attrs: unknown) => {
        state.updates.push(attrs);
        return { error: state.error };
      },
    },
  }),
}));

beforeEach(() => {
  state.user = { id: "u1" };
  state.error = null;
  state.updates = [];
  state.redirects = [];
});

describe("completeOnboarding", () => {
  it("stamps onboarded_at in metadata, then redirects to the dashboard", async () => {
    await expect(completeOnboarding("dashboard")).rejects.toThrow("NEXT_REDIRECT");
    expect(state.updates).toHaveLength(1);
    const { data } = state.updates[0] as { data: Record<string, unknown> };
    // Only this key: updateUser merges, so last_persona_id is left alone.
    expect(Object.keys(data)).toEqual(["onboarded_at"]);
    expect(typeof data.onboarded_at).toBe("string");
    expect(state.redirects).toEqual(["/"]);
  });

  it("sends the connected-apps exit to 06's section, not a second connect flow", async () => {
    await expect(completeOnboarding("connected-apps")).rejects.toThrow("NEXT_REDIRECT");
    expect(state.redirects).toEqual(["/settings#connected-apps"]);
  });

  it("refuses an exit outside the closed set, writing nothing", async () => {
    await expect(completeOnboarding("//evil.example" as never)).resolves.toBe("invalid");
    expect(state.updates).toHaveLength(0);
    expect(state.redirects).toHaveLength(0);
  });

  it("throws rather than redirecting when the metadata write fails", async () => {
    state.error = { message: "boom" };
    await expect(completeOnboarding("dashboard")).rejects.toThrow(/Failed to finish onboarding/);
    expect(state.redirects).toHaveLength(0);
  });

  it("sends a caller with no session to /login", async () => {
    state.user = null;
    await expect(completeOnboarding("dashboard")).rejects.toThrow("NEXT_REDIRECT");
    expect(state.redirects).toEqual(["/login"]);
    expect(state.updates).toHaveLength(0);
  });
});

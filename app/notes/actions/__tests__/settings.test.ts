import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveCaptureSettings } from "@/app/notes/actions/settings";

/** Every call made against user_settings, in order. */
const chain: [string, ...unknown[]][] = [];

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  error: null as { message: string } | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    from: (table: string) => {
      chain.push(["from", table]);
      const builder: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: state.error }).then(resolve),
      };
      for (const m of ["select", "insert", "upsert", "update", "delete", "eq", "is", "in"]) {
        builder[m] = (...args: unknown[]) => {
          chain.push([m, ...args]);
          return builder;
        };
      }
      return builder;
    },
  }),
}));

beforeEach(() => {
  chain.length = 0;
  state.user = { id: "u1" };
  state.error = null;
});

describe("saveCaptureSettings", () => {
  it("upserts the caller's own row, keyed on user_id", async () => {
    await expect(saveCaptureSettings({ requireCitations: false })).resolves.toBe("written");

    expect(chain).toContainEqual(["from", "user_settings"]);
    const upsert = chain.find(([m]) => m === "upsert");
    expect(upsert?.[1]).toEqual({ user_id: "u1", require_citations: false });
    // The conflict target is the primary key: a second save updates the row,
    // it never writes a second one.
    expect(upsert?.[2]).toEqual({ onConflict: "user_id" });
  });

  it("never filters on user_id — RLS scopes the write", async () => {
    await saveCaptureSettings({ requireCitations: true });
    expect(chain.filter(([m, col]) => m === "eq" && col === "user_id")).toHaveLength(0);
  });

  it("refuses a payload that is not a boolean, before touching the database", async () => {
    await expect(
      saveCaptureSettings({ requireCitations: "yes" } as unknown as { requireCitations: boolean }),
    ).resolves.toBe("invalid");
    expect(chain).toHaveLength(0);
  });

  it("writes nothing when nobody is signed in", async () => {
    state.user = null;
    await expect(saveCaptureSettings({ requireCitations: true })).resolves.toBe("not-found");
    expect(chain.find(([m]) => m === "upsert")).toBeUndefined();
  });

  it("throws when the database refuses, rather than reporting a save", async () => {
    state.error = { message: "new row violates row-level security policy" };
    await expect(saveCaptureSettings({ requireCitations: true })).rejects.toThrow(
      /row-level security/,
    );
  });
});

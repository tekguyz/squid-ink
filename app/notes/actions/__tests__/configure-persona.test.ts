import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addQuickAction,
  removeQuickAction,
  setDefaultPersona,
  setPersonaDepth,
} from "@/app/notes/actions/configure-persona";
import {
  MAX_QUICK_ACTIONS,
  MAX_QUICK_ACTION_LENGTH,
} from "@/lib/notes/persona-config";
import type { PersonaDepth } from "@/lib/notes/view-types";

/** Every call the action made against `personas`, in order. One array is
 *  enough here — unlike persona.test.ts, this module touches a single table,
 *  so there are no two chains to tell apart. */
const chain: [string, ...unknown[]][] = [];

const state = vi.hoisted(() => ({
  /** What the row read returns. null is the zero-persona account, and is also
   *  what another user's slug looks like once RLS has filtered it — the two
   *  must be indistinguishable. */
  row: { quick_actions: ["Extract decisions only"] } as {
    quick_actions: string[];
  } | null,
  /** What the guarded UPDATE matched. [] means no such lens. */
  updateResult: { data: [{ id: "p-uuid" }], error: null } as {
    data: { id: string }[];
    error: { message: string } | null;
  },
  /** The parameter is declared so the assertion below can read back exactly
   *  what was written, rather than trusting toHaveBeenCalledWith alone. */
  updateUser: vi.fn(
    async (_args: { data: { last_persona_id: string } }) =>
      ({ data: {}, error: null }) as {
        data: unknown;
        error: { message: string } | null;
      },
  ),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { updateUser: state.updateUser },
    from: () => {
      const link: Record<string, unknown> = {
        maybeSingle: async () => ({ data: state.row, error: null }),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(state.updateResult).then(resolve),
      };
      for (const method of ["select", "update", "eq"]) {
        link[method] = (...args: unknown[]) => {
          chain.push([method, ...args]);
          return link;
        };
      }
      return link;
    },
  }),
}));

/** Did anything actually write? `update` is the only mutating verb here. */
const wrote = () => chain.some(([method]) => method === "update");

const listOf = (n: number) => Array.from({ length: n }, (_, i) => `Action ${i}`);

beforeEach(() => {
  chain.length = 0;
  state.row = { quick_actions: ["Extract decisions only"] };
  state.updateResult = { data: [{ id: "p-uuid" }], error: null };
  state.updateUser.mockClear();
  state.updateUser.mockImplementation(async () => ({ data: {}, error: null }));
});

describe("setPersonaDepth — the union is checked before the database", () => {
  it("refuses a depth outside the three-value union, and writes nothing", async () => {
    // THE POINT OF THIS TEST. A Server Action is a public HTTP endpoint, so
    // the column's check constraint is the floor, not the guard: without this
    // branch a crafted request reaches Postgres and comes back as an error
    // string rather than an outcome the screen can render. Depth also decides
    // Gemini's thinking_level, so a bad value is a cost question, not a
    // cosmetic one.
    expect(await setPersonaDepth("investor", "deep" as PersonaDepth)).toBe(
      "invalid",
    );
    expect(await setPersonaDepth("investor", "DENSE" as PersonaDepth)).toBe(
      "invalid",
    );
    expect(await setPersonaDepth("investor", "" as PersonaDepth)).toBe("invalid");
    expect(wrote()).toBe(false);
  });

  it("refuses an empty slug before it reaches a query", async () => {
    expect(await setPersonaDepth("", "dense")).toBe("invalid");
    expect(wrote()).toBe(false);
  });

  it("writes each of the three real depths", async () => {
    for (const depth of ["brief", "dense", "exhaustive"] as PersonaDepth[]) {
      chain.length = 0;
      expect(await setPersonaDepth("investor", depth)).toBe("written");
      expect(chain).toContainEqual(["update", { depth }]);
      expect(chain).toContainEqual(["eq", "slug", "investor"]);
    }
  });

  it("reports 'no-persona' when the slug matches no row this user owns", async () => {
    state.updateResult = { data: [], error: null };
    expect(await setPersonaDepth("investor", "brief")).toBe("no-persona");
  });

  it("never filters on user_id — RLS supplies the owner", async () => {
    await setPersonaDepth("investor", "brief");
    expect(chain.filter(([m]) => m === "eq").map(([, col]) => col)).not.toContain(
      "user_id",
    );
  });
});

describe("addQuickAction — the cap is enforced here, not only in the UI", () => {
  it(`refuses the ${MAX_QUICK_ACTIONS + 1}th quick action and writes nothing`, async () => {
    state.row = { quick_actions: listOf(MAX_QUICK_ACTIONS) };
    expect(await addQuickAction("investor", "One more")).toBe("at-capacity");
    expect(wrote()).toBe(false);
  });

  it(`accepts the ${MAX_QUICK_ACTIONS}th`, async () => {
    state.row = { quick_actions: listOf(MAX_QUICK_ACTIONS - 1) };
    expect(await addQuickAction("investor", "Last one")).toBe("written");
    expect(chain).toContainEqual([
      "update",
      { quick_actions: [...listOf(MAX_QUICK_ACTIONS - 1), "Last one"] },
    ]);
  });

  it("refuses blank, whitespace-only and over-long text", async () => {
    expect(await addQuickAction("investor", "")).toBe("invalid");
    expect(await addQuickAction("investor", "   ")).toBe("invalid");
    expect(
      await addQuickAction("investor", "x".repeat(MAX_QUICK_ACTION_LENGTH + 1)),
    ).toBe("invalid");
    expect(wrote()).toBe(false);
  });

  it("stores the normalized form, so a double space cannot slip the duplicate check", async () => {
    await addQuickAction("investor", "  Timeline  of   blockers  ");
    expect(chain).toContainEqual([
      "update",
      { quick_actions: ["Extract decisions only", "Timeline of blockers"] },
    ]);
  });

  it("refuses a duplicate — the list renders keyed by its own text", async () => {
    expect(await addQuickAction("investor", "Extract decisions only")).toBe(
      "duplicate",
    );
    expect(wrote()).toBe(false);
  });

  it("reports 'no-persona' for a slug with no row", async () => {
    state.row = null;
    expect(await addQuickAction("investor", "Anything")).toBe("no-persona");
    expect(wrote()).toBe(false);
  });
});

describe("removeQuickAction — by text, never by index", () => {
  it("removes the matching string", async () => {
    state.row = { quick_actions: ["Keep me", "Drop me"] };
    expect(await removeQuickAction("investor", "Drop me")).toBe("written");
    expect(chain).toContainEqual(["update", { quick_actions: ["Keep me"] }]);
  });

  it("refuses text the row does not hold rather than removing a neighbour", async () => {
    // A stale client sending an index would have taken out whatever now sits
    // at that position. Text either matches or it does not.
    state.row = { quick_actions: ["Keep me"] };
    expect(await removeQuickAction("investor", "Gone already")).toBe("invalid");
    expect(wrote()).toBe(false);
  });
});

describe("setDefaultPersona — the preference lands as a slug", () => {
  it("writes the slug into Auth user metadata, never a uuid", async () => {
    // THE POINT OF THIS TEST. A uuid is per-user and does not survive a
    // reseed, which is why personas.sql chose slug as its key and why the
    // client sees no uuids anywhere in this project. seedNotePersona reads
    // this same field back and looks it up by slug.
    expect(await setDefaultPersona("sales-coach")).toBe("written");
    expect(state.updateUser).toHaveBeenCalledWith({
      data: { last_persona_id: "sales-coach" },
    });

    const written = state.updateUser.mock.calls[0][0].data.last_persona_id;
    expect(written).toBe("sales-coach");
    expect(written).not.toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("refuses a slug the account owns no row for, and writes no metadata", async () => {
    // An unknown slug parked in metadata would make seedNotePersona miss on
    // every note the account creates from then on.
    state.row = null;
    expect(await setDefaultPersona("interviewer")).toBe("no-persona");
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it("refuses an empty slug before it reaches a query", async () => {
    expect(await setDefaultPersona("")).toBe("invalid");
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it("throws rather than swallowing a failed metadata write", async () => {
    // Unlike setNotePersona, where the preference is a convenience beside a
    // note that was already written correctly, here the preference IS the
    // thing the user asked for. A swallowed failure would be a button that
    // reports success and changed nothing.
    state.updateUser.mockImplementation(async () => ({
      data: {},
      error: { message: "session expired" },
    }));
    await expect(setDefaultPersona("sales-coach")).rejects.toThrow(
      /session expired/,
    );
  });
});

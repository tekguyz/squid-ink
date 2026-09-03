import { beforeEach, describe, expect, it, vi } from "vitest";
import { setNotePersona, seedNotePersona } from "@/app/notes/actions/persona";
import { DEFAULT_PERSONA_ID } from "@/lib/notes/default-persona";

/** TWO recording arrays, not one. The notes chain proves the guard; the
 *  personas chain proves WHICH slug was looked up, which is the only way to
 *  tell "seeded from the remembered lens" from "seeded from the default". A
 *  single shared array cannot separate them. */
const notesChain: [string, ...unknown[]][] = [];
const personaChain: [string, ...unknown[]][] = [];

type Result = { data: unknown; error: { message: string } | null };

const state = vi.hoisted(() => ({
  /** Answers the personas lookup. A QUEUE: seedNotePersona may look up a
   *  remembered slug, miss, and look up the default. The last entry repeats. */
  personaLookups: [] as Result[],
  notesResult: { data: [{ id: "n1" }], error: null } as Result,
  user: { id: "u1", user_metadata: {} } as {
    id: string;
    user_metadata: Record<string, unknown>;
  } | null,
  updateUser: vi.fn(async () => ({ data: {}, error: null })),
}));

const nextPersona = (): Result =>
  state.personaLookups.length > 1
    ? state.personaLookups.shift()!
    : state.personaLookups[0];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
      updateUser: state.updateUser,
    },
    from: (table: string) => {
      const isNotes = table === "notes";
      const sink = isNotes ? notesChain : personaChain;
      const chain: Record<string, unknown> = {
        maybeSingle: async () => nextPersona(),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(isNotes ? state.notesResult : nextPersona()).then(resolve),
      };
      for (const m of ["select", "update", "eq", "is", "in"]) {
        chain[m] = (...args: unknown[]) => {
          sink.push([m, ...args]);
          return chain;
        };
      }
      return chain;
    },
  }),
}));

/** Every slug the action asked the personas table for, in order. */
const lookedUpSlugs = () =>
  personaChain
    .filter(([m, col]) => m === "eq" && col === "slug")
    .map(([, , val]) => val);

beforeEach(() => {
  notesChain.length = 0;
  personaChain.length = 0;
  state.personaLookups = [{ data: { id: "p-uuid" }, error: null }];
  state.notesResult = { data: [{ id: "n1" }], error: null };
  state.user = { id: "u1", user_metadata: {} };
  state.updateUser.mockClear();
});

describe("setNotePersona — the guarded write", () => {
  it("refuses to write once the lens is frozen", async () => {
    // ENFORCEMENT, not decoration. A Server Action is a public HTTP endpoint;
    // the rail's disabled attribute is UX only. This guard is what holds.
    await setNotePersona("n1", "sales-coach");

    expect(notesChain).toContainEqual([
      "in",
      "processing_status",
      ["local", "uploading"],
    ]);
    expect(notesChain).toContainEqual(["is", "notegen_status", null]);
    expect(notesChain).toContainEqual(["eq", "id", "n1"]);
  });

  it("writes the resolved uuid, never the slug", async () => {
    await setNotePersona("n1", "sales-coach");
    expect(notesChain).toContainEqual(["update", { persona_id: "p-uuid" }]);
  });

  it("reports 'locked' when the guarded update matches nothing", async () => {
    state.notesResult = { data: [], error: null };
    expect(await setNotePersona("n1", "sales-coach")).toBe("locked");
  });

  it("reports 'written' when it matches", async () => {
    expect(await setNotePersona("n1", "sales-coach")).toBe("written");
  });

  it("never filters on user_id — RLS supplies the owner", async () => {
    // A redundant filter would mask an RLS failure instead of exposing it.
    await setNotePersona("n1", "sales-coach");
    const columns = notesChain
      .filter(([m]) => m === "eq" || m === "in" || m === "is")
      .map(([, col]) => col);
    expect(columns).not.toContain("user_id");
  });

  it("does not narrow on persona_id — a real choice may overwrite one", async () => {
    // Only seeding carries that clause. Selection must be able to replace an
    // earlier selection while the note is still unfrozen.
    await setNotePersona("n1", "sales-coach");
    expect(notesChain).not.toContainEqual(["is", "persona_id", null]);
  });
});

describe("setNotePersona — the remembered preference", () => {
  it("remembers the SLUG, not the uuid", async () => {
    // A uuid is per-user and does not survive a reseed.
    await setNotePersona("n1", "sales-coach");
    expect(state.updateUser).toHaveBeenCalledWith({
      data: { last_persona_id: "sales-coach" },
    });
  });

  it("does not move the default when the write was refused", async () => {
    // A refused write must not change what every future note defaults to.
    state.notesResult = { data: [], error: null };
    await setNotePersona("n1", "sales-coach");
    expect(state.updateUser).not.toHaveBeenCalled();
  });
});

describe("setNotePersona — an account with no personas", () => {
  it("writes nothing and reports 'no-persona'", async () => {
    // The zero-row account default-persona.ts describes. Leaving persona_id
    // null is what keeps resolvePersonaFor's fallback branch untouched.
    state.personaLookups = [{ data: null, error: null }];
    expect(await setNotePersona("n1", "sales-coach")).toBe("no-persona");
    expect(notesChain).toEqual([]);
    expect(state.updateUser).not.toHaveBeenCalled();
  });
});

describe("seedNotePersona", () => {
  it("uses the remembered slug when there is one", async () => {
    state.user = { id: "u1", user_metadata: { last_persona_id: "investor" } };
    await seedNotePersona("n1");
    expect(lookedUpSlugs()).toEqual(["investor"]);
  });

  it("uses the default slug when nothing is remembered", async () => {
    expect(await seedNotePersona("n1")).toBe("written");
    expect(lookedUpSlugs()).toEqual([DEFAULT_PERSONA_ID]);
  });

  it("falls back to the default when the remembered lens is gone", async () => {
    // A renamed or deleted persona must not strand every new note.
    state.user = { id: "u1", user_metadata: { last_persona_id: "gone" } };
    state.personaLookups = [
      { data: null, error: null },
      { data: { id: "p-uuid" }, error: null },
    ];
    expect(await seedNotePersona("n1")).toBe("written");
    expect(lookedUpSlugs()).toEqual(["gone", DEFAULT_PERSONA_ID]);
  });

  it("guards on a null persona_id so it can never overwrite a choice", async () => {
    await seedNotePersona("n1");
    expect(notesChain).toContainEqual(["is", "persona_id", null]);
  });

  it("carries the frozen-state guard too", async () => {
    await seedNotePersona("n1");
    expect(notesChain).toContainEqual([
      "in",
      "processing_status",
      ["local", "uploading"],
    ]);
    expect(notesChain).toContainEqual(["is", "notegen_status", null]);
  });

  it("does NOT write the preference — seeding is not a user decision", async () => {
    await seedNotePersona("n1");
    expect(state.updateUser).not.toHaveBeenCalled();
  });

  it("reports 'no-persona' for an account with no lenses at all", async () => {
    state.personaLookups = [{ data: null, error: null }];
    expect(await seedNotePersona("n1")).toBe("no-persona");
    expect(notesChain).toEqual([]);
  });

  it("reports 'not-found' when nobody is signed in", async () => {
    state.user = null;
    expect(await seedNotePersona("n1")).toBe("not-found");
    expect(notesChain).toEqual([]);
  });
});

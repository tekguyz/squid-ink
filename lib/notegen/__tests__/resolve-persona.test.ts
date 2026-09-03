import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePersonaFor } from "@/lib/notegen/resolve-persona";
import {
  DEFAULT_PERSONA_FALLBACK,
  DEFAULT_PERSONA_ID,
} from "@/lib/notes/default-persona";

type Result = { data: unknown; error: unknown };

/** Unlike notegen-ports.test.ts's fake, this one answers a QUEUE of results.
 *  resolvePersonaFor may issue a SECOND query after the first misses, and a
 *  single fixed result cannot tell those two branches apart — the fallthrough
 *  would pass for the wrong reason.
 *
 *  perQuery groups the chain by from() call, so a test can assert the columns
 *  of the second query without the first one's eq() calls bleeding in. */
function fakeDb(...results: Result[]) {
  const tables: string[] = [];
  const perQuery: [string, ...unknown[]][][] = [];
  const queue = [...results];
  let index = -1;

  const next = () => (queue.length > 1 ? queue.shift()! : queue[0]);

  const builder: Record<string, unknown> = {
    maybeSingle: vi.fn(async () => next()),
    then: (resolve: (v: unknown) => void) => resolve(next()),
  };

  for (const method of ["select", "eq", "is", "in", "limit", "order"]) {
    builder[method] = vi.fn((...args: unknown[]) => {
      perQuery[index].push([method, ...args]);
      return builder;
    });
  }

  const db = {
    from: vi.fn((table: string) => {
      tables.push(table);
      index += 1;
      perQuery.push([]);
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { db, tables, perQuery };
}

const eqsOf = (query: [string, ...unknown[]][]) =>
  query.filter(([m]) => m === "eq").map(([, col, val]) => [col, val]);

const NOTE_PERSONA = { slug: "sales-coach", name: "Sales Coach", depth: "dense" };
const NEUTRAL = { slug: DEFAULT_PERSONA_ID, name: "Neutral Analyst", depth: "dense" };

describe("resolvePersonaFor — the note's own persona", () => {
  it("scopes the lookup by BOTH id and user_id", async () => {
    // Composite ownership, the same check notes_persona_id_fkey enforces. The
    // cron caller runs as service_role and bypasses RLS, so an id-only lookup
    // could return another account's lens.
    const { db, perQuery } = fakeDb({ data: NOTE_PERSONA, error: null });

    await resolvePersonaFor(db, "u1", "p-uuid");

    expect(eqsOf(perQuery[0])).toEqual([
      ["id", "p-uuid"],
      ["user_id", "u1"],
    ]);
  });

  it("returns that persona with source 'note'", async () => {
    const { db } = fakeDb({ data: NOTE_PERSONA, error: null });
    expect(await resolvePersonaFor(db, "u1", "p-uuid")).toEqual({
      slug: "sales-coach",
      name: "Sales Coach",
      depth: "dense",
      source: "note",
    });
  });

  it("issues exactly ONE query when the note's persona resolves", async () => {
    const { db, tables } = fakeDb({ data: NOTE_PERSONA, error: null });
    await resolvePersonaFor(db, "u1", "p-uuid");
    expect(tables).toEqual(["personas"]);
  });

  it("falls through to the slug path when the id resolves to no row", async () => {
    // A lens deleted between selection and generation. on delete set null
    // normally nulls the column first; this is the belt for the window where
    // it has not yet. Refusing to generate would be worse than the default.
    const { db, tables } = fakeDb(
      { data: null, error: null },
      { data: NEUTRAL, error: null },
    );
    expect(await resolvePersonaFor(db, "u1", "p-uuid")).toEqual({
      slug: DEFAULT_PERSONA_ID,
      name: "Neutral Analyst",
      depth: "dense",
      source: "row",
    });
    expect(tables).toEqual(["personas", "personas"]);
  });

  it("throws rather than falling back when the id lookup errors", async () => {
    const { db } = fakeDb({
      data: null,
      error: { message: "permission denied for table personas" },
    });
    await expect(resolvePersonaFor(db, "u1", "p-uuid")).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("resolvePersonaFor — null personaId keeps today's behaviour", () => {
  it("filters on user_id and slug, never id, never name", async () => {
    const { db, perQuery } = fakeDb({ data: NEUTRAL, error: null });

    await resolvePersonaFor(db, "u1", null);

    const eqs = eqsOf(perQuery[0]);
    expect(eqs).toEqual([
      ["user_id", "u1"],
      ["slug", DEFAULT_PERSONA_ID],
    ]);
    const columns = eqs.map(([c]) => c);
    expect(columns).not.toContain("id");
    expect(columns).not.toContain("name");
  });

  it("reports source 'row' when the account is provisioned", async () => {
    const { db } = fakeDb({ data: { ...NEUTRAL, depth: "brief" }, error: null });
    expect(await resolvePersonaFor(db, "u1", null)).toEqual({
      slug: DEFAULT_PERSONA_ID,
      name: "Neutral Analyst",
      depth: "brief",
      source: "row",
    });
  });

  it("falls back with source 'fallback' on zero rows", async () => {
    // An account created before the 2026-08-31 provisioning trigger, and
    // deliberately not backfilled.
    const { db } = fakeDb({ data: null, error: null });
    expect(await resolvePersonaFor(db, "u1", null)).toEqual({
      slug: DEFAULT_PERSONA_FALLBACK.id,
      name: DEFAULT_PERSONA_FALLBACK.name,
      depth: DEFAULT_PERSONA_FALLBACK.depth,
      source: "fallback",
    });
  });

  it("throws on a real query error rather than silently falling back", async () => {
    // permission denied is exactly what a missing service_role grant returns.
    // Swallowing it into the fallback would hide the grant gap behind output
    // that looks correct.
    const { db } = fakeDb({
      data: null,
      error: { message: "permission denied for table personas" },
    });
    await expect(resolvePersonaFor(db, "u1", null)).rejects.toThrow(
      /permission denied/,
    );
  });

  it("issues exactly one query", async () => {
    const { db, tables } = fakeDb({ data: NEUTRAL, error: null });
    await resolvePersonaFor(db, "u1", null);
    expect(tables).toEqual(["personas"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmRuleMatch,
  markRuleMatchFalsePositive,
} from "@/app/notes/actions/collection-rules";
import { countMatches } from "@/lib/collection-rules/rule-engine";

/** One recording array per table, not one shared array. Which table a verb
 *  landed on is the whole point of these assertions — a single sink could not
 *  tell "flipped the match" from "deleted the membership". */
const chains: Record<string, [string, ...unknown[]][]> = {
  collection_rule_matches: [],
  note_collections: [],
  notes: [],
  note_chunks: [],
};

type Result = { data: unknown; error: { message: string } | null };

const state = vi.hoisted(() => ({
  /** What the guarded UPDATE on collection_rule_matches reports back. null is
   *  a zero-row claim — the row was not in the state the action moves it out
   *  of. */
  matchResult: { data: null, error: null } as Result,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
    },
    from: (table: string) => {
      const sink = (chains[table] ??= []);
      const answer: Result =
        table === "collection_rule_matches"
          ? state.matchResult
          : { data: null, error: null };

      const chain: Record<string, unknown> = {
        maybeSingle: async () => answer,
        single: async () => answer,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(answer).then(resolve),
      };
      for (const verb of [
        "select",
        "insert",
        "update",
        "upsert",
        "delete",
        "eq",
        "order",
        "limit",
      ]) {
        chain[verb] = (...args: unknown[]) => {
          sink.push([verb, ...args]);
          return chain;
        };
      }
      return chain;
    },
  }),
}));

const FILED_MATCH = {
  id: "m1",
  note_id: "note-1",
  collection_id: "col-1",
  user_id: "u1",
};

beforeEach(() => {
  for (const key of Object.keys(chains)) chains[key].length = 0;
  state.matchResult = { data: FILED_MATCH, error: null };
});

describe("markRuleMatchFalsePositive", () => {
  it("flips the disposition and removes the membership", async () => {
    const outcome = await markRuleMatchFalsePositive("m1");

    expect(outcome).toBe("written");
    expect(chains.collection_rule_matches).toContainEqual([
      "update",
      { disposition: "false_positive" },
    ]);
    expect(chains.note_collections).toContainEqual(["delete"]);
    expect(chains.note_collections).toContainEqual(["eq", "note_id", "note-1"]);
    expect(chains.note_collections).toContainEqual([
      "eq",
      "collection_id",
      "col-1",
    ]);
  });

  it("is GUARDED on 'filed', which is what makes it idempotent", async () => {
    // A double click, or two tabs, must not delete twice. The guard is also
    // what refuses a 'needs_review' match: it was never filed, so there is no
    // membership to take back.
    await markRuleMatchFalsePositive("m1");
    expect(chains.collection_rule_matches).toContainEqual([
      "eq",
      "disposition",
      "filed",
    ]);
  });

  it("touches nothing when the guarded update claims no row", async () => {
    state.matchResult = { data: null, error: null };

    const outcome = await markRuleMatchFalsePositive("m1");

    expect(outcome).toBe("not-found");
    expect(chains.note_collections).toEqual([]);
  });

  it("NEVER deletes the match row — it is what the counter is derived from", async () => {
    await markRuleMatchFalsePositive("m1");
    expect(
      chains.collection_rule_matches.some(([verb]) => verb === "delete"),
    ).toBe(false);
  });

  it("does not touch the note or its chunks", async () => {
    // One row leaves note_collections. That is the entire effect.
    await markRuleMatchFalsePositive("m1");
    expect(chains.notes).toEqual([]);
    expect(chains.note_chunks).toEqual([]);
  });

  it("moves the note from the filed count to the false-positive count", async () => {
    // The counters are DERIVED, so the proof that marking increments the
    // false-positive count is that re-deriving from the changed record gives
    // the new number. There is no column to check.
    const now = new Date("2026-09-11T12:00:00.000Z");
    const matchedAt = new Date(now.getTime() - 1000).toISOString();

    const before = countMatches([{ disposition: "filed", matchedAt }], now);
    expect(before).toEqual({ matched: 1, neededReview: 0, falsePositives: 0 });

    await markRuleMatchFalsePositive("m1");
    const written = chains.collection_rule_matches.find(
      ([verb]) => verb === "update",
    )?.[1] as { disposition: "false_positive" };

    const after = countMatches(
      [{ disposition: written.disposition, matchedAt }],
      now,
    );
    expect(after).toEqual({ matched: 1, neededReview: 0, falsePositives: 1 });
  });
});

describe("confirmRuleMatch", () => {
  it("is guarded on 'needs_review' and then files the note", async () => {
    const outcome = await confirmRuleMatch("m1");

    expect(outcome).toBe("written");
    expect(chains.collection_rule_matches).toContainEqual([
      "update",
      { disposition: "filed" },
    ]);
    expect(chains.collection_rule_matches).toContainEqual([
      "eq",
      "disposition",
      "needs_review",
    ]);
    // THE SHARED write path, not a second insert.
    expect(chains.note_collections).toContainEqual([
      "upsert",
      { note_id: "note-1", collection_id: "col-1", user_id: "u1" },
      { onConflict: "note_id,collection_id", ignoreDuplicates: true },
    ]);
  });

  it("files nothing when the guarded update claims no row", async () => {
    state.matchResult = { data: null, error: null };

    expect(await confirmRuleMatch("m1")).toBe("not-found");
    expect(chains.note_collections).toEqual([]);
  });
});

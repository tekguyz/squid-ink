import { beforeEach, describe, expect, it, vi } from "vitest";
import { addNoteTag, removeNoteTag } from "@/app/notes/actions/tags";

/** Two recording arrays, one per table. Which table a clause landed on is the
 *  whole point of several of these assertions — a single shared array cannot
 *  tell "scoped the tag read" from "scoped the join write". */
const tagsChain: [string, ...unknown[]][] = [];
const linkChain: [string, ...unknown[]][] = [];

type Result = { data: unknown; error: { message: string; code?: string } | null };

const state = vi.hoisted(() => ({
  /** Answers .from("tags")...maybeSingle() — the slug lookup. */
  tagLookup: { data: { id: "t-uuid" }, error: null } as Result,
  /** Answers the note_tags write. */
  linkResult: { data: null, error: null } as Result,
  user: { id: "u1" } as { id: string } | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user }, error: null }),
    },
    from: (table: string) => {
      const isTags = table === "tags";
      const sink = isTags ? tagsChain : linkChain;
      const result = () => (isTags ? state.tagLookup : state.linkResult);
      const chain: Record<string, unknown> = {
        maybeSingle: async () => result(),
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(result()).then(resolve),
      };
      for (const m of ["select", "insert", "upsert", "update", "delete", "eq", "is", "in"]) {
        chain[m] = (...args: unknown[]) => {
          sink.push([m, ...args]);
          return chain;
        };
      }
      return chain;
    },
  }),
}));

beforeEach(() => {
  tagsChain.length = 0;
  linkChain.length = 0;
  state.tagLookup = { data: { id: "t-uuid" }, error: null };
  state.linkResult = { data: null, error: null };
  state.user = { id: "u1" };
});

/** The options object of the one upsert made against a table. */
const upsertOptions = (chain: [string, ...unknown[]][]) =>
  chain.find(([m]) => m === "upsert")?.[2] as
    | { onConflict?: string; ignoreDuplicates?: boolean }
    | undefined;

describe("addNoteTag — idempotence", () => {
  it("applies the same tag twice without a second row", async () => {
    // IDEMPOTENT BY CONSTRUCTION, not by checking first: on conflict do
    // nothing against note_tags' composite primary key. A read-then-write
    // would leave a window in which two tabs both see "absent" and insert.
    expect(await addNoteTag("n1", "pricing")).toBe("written");
    expect(await addNoteTag("n1", "pricing")).toBe("written");

    expect(upsertOptions(linkChain)).toEqual({
      onConflict: "note_id,tag_id",
      ignoreDuplicates: true,
    });
  });

  it("creates the tag implicitly, and only once", async () => {
    // There is no tag-management surface in this feature, so typing a name is
    // the only way a tag is created. The unique key is what makes the second
    // attempt resolve to the row that is already there.
    await addNoteTag("n1", "pricing");
    expect(upsertOptions(tagsChain)).toEqual({
      onConflict: "user_id,slug",
      ignoreDuplicates: true,
    });
  });

  it("stores a token name, never a colour", async () => {
    // app/globals.css is the only file in this project that names a colour.
    await addNoteTag("n1", "pricing");
    const values = tagsChain.find(([m]) => m === "upsert")?.[1] as {
      color_token: string;
      slug: string;
      name: string;
    };
    expect(values.color_token).toMatch(/^tag-[1-5]$/);
    expect(values.slug).toBe("pricing");
  });

  it("normalises before writing, so two spellings are one tag", async () => {
    await addNoteTag("n1", "#Pricing  ");
    const values = tagsChain.find(([m]) => m === "upsert")?.[1] as {
      slug: string;
      name: string;
    };
    expect(values.slug).toBe("pricing");
    expect(values.name).toBe("Pricing");
  });

  it("refuses text that normalises to nothing, without touching the database", async () => {
    expect(await addNoteTag("n1", "   #  ")).toBe("invalid");
    expect(tagsChain).toEqual([]);
    expect(linkChain).toEqual([]);
  });
});

describe("addNoteTag — tenant scoping", () => {
  it("never filters on user_id — RLS supplies the owner", async () => {
    // A redundant filter would mask an RLS failure instead of exposing it.
    await addNoteTag("n1", "pricing");
    const filtered = [...tagsChain, ...linkChain]
      .filter(([m]) => m === "eq" || m === "in" || m === "is")
      .map(([, column]) => column);
    expect(filtered).not.toContain("user_id");
  });

  it("still SUPPLIES user_id on both inserts — the policy checks it", async () => {
    // Not the same thing as filtering. The insert policies are
    // `with check ((select auth.uid()) = user_id)`, so a row without it is
    // refused outright.
    await addNoteTag("n1", "pricing");
    expect(tagsChain.find(([m]) => m === "upsert")?.[1]).toMatchObject({
      user_id: "u1",
    });
    expect(linkChain.find(([m]) => m === "upsert")?.[1]).toMatchObject({
      user_id: "u1",
      note_id: "n1",
      tag_id: "t-uuid",
    });
  });

  it("reports another tenant's note as not-found, not as an error", async () => {
    // 23503 is note_tags' COMPOSITE foreign key refusing a note this user does
    // not own. A foreign key is validated as the referenced table's owner and
    // is not subject to RLS, which is why the key carries user_id at all.
    // Reporting it as "not-found" gives the same answer a missing note gives,
    // so nothing about another account's rows leaks.
    state.linkResult = {
      data: null,
      error: { code: "23503", message: "note_tags_note_id_fkey" },
    };
    expect(await addNoteTag("someone-elses-note", "pricing")).toBe("not-found");
  });

  it("does nothing at all when nobody is signed in", async () => {
    state.user = null;
    expect(await addNoteTag("n1", "pricing")).toBe("not-found");
    expect(tagsChain).toEqual([]);
    expect(linkChain).toEqual([]);
  });
});

describe("removeNoteTag", () => {
  it("removes the pair and leaves the tag row alone", async () => {
    // Removing the last note from a tag leaves an unused tag. Deleting it is a
    // different decision and this feature has no surface that makes it.
    expect(await removeNoteTag("n1", "pricing")).toBe("written");
    expect(linkChain).toContainEqual(["delete"]);
    expect(linkChain).toContainEqual(["eq", "note_id", "n1"]);
    expect(linkChain).toContainEqual(["eq", "tag_id", "t-uuid"]);
    expect(tagsChain.some(([m]) => m === "delete")).toBe(false);
  });

  it("is idempotent — removing a tag that is not there is not an error", async () => {
    expect(await removeNoteTag("n1", "pricing")).toBe("written");
    expect(await removeNoteTag("n1", "pricing")).toBe("written");
  });

  it("reports another tenant's slug as not-found", async () => {
    // The slug lookup is scoped by RLS, so a tag belonging to somebody else
    // resolves to no row — and nothing is deleted.
    state.tagLookup = { data: null, error: null };
    expect(await removeNoteTag("n1", "their-tag")).toBe("not-found");
    expect(linkChain.some(([m]) => m === "delete")).toBe(false);
  });
});

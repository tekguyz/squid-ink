import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addNoteToCollection,
  createCollection,
  deleteCollection,
  removeNoteFromCollection,
  renameCollection,
} from "@/app/notes/actions/collections";

/**
 * A REAL LITTLE STORE, not a call recorder.
 *
 * The claim these tests exist to prove is "a note can sit in two collections
 * at once, and removing it from one leaves the other alone". A mock that only
 * records which clauses were called cannot prove that — it can only prove the
 * action asked for the right thing. So the fake below actually holds rows and
 * actually applies the writes, and the assertions read the rows back.
 *
 * It models exactly what supabase/schemas/collections.sql declares and nothing
 * else: unique (user_id, slug) on collections, a (note_id, collection_id)
 * primary key on note_collections, and `on delete cascade` from a deleted
 * collection to its memberships.
 */

interface CollectionRecord {
  id: string;
  user_id: string;
  slug: string;
  name: string;
}
interface LinkRecord {
  note_id: string;
  collection_id: string;
  user_id: string;
}

const db = vi.hoisted(() => ({
  collections: [] as CollectionRecord[],
  links: [] as LinkRecord[],
  nextId: 0,
  user: { id: "u1" } as { id: string } | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => {
  type Row = Record<string, unknown>;

  const rowsOf = (table: string): Row[] =>
    table === "collections"
      ? (db.collections as unknown as Row[])
      : (db.links as unknown as Row[]);

  const makeChain = (table: string) => {
    const filters: [string, unknown][] = [];
    let op: "select" | "delete" | "update" | "upsert" = "select";
    let payload: Row = {};

    const matching = () =>
      rowsOf(table).filter((row) => filters.every(([c, v]) => row[c] === v));

    const apply = () => {
      const rows = rowsOf(table);

      if (op === "delete") {
        for (const row of matching()) {
          rows.splice(rows.indexOf(row), 1);
          // `on delete cascade` from collections to note_collections. Deleting
          // a collection takes its memberships and NOTHING else — the notes
          // themselves are not this table's to remove.
          if (table === "collections") {
            db.links = db.links.filter((l) => l.collection_id !== row.id);
          }
        }
        return { data: null, error: null };
      }

      if (op === "update") {
        for (const row of matching()) {
          const clash = db.collections.find(
            (c) =>
              c.user_id === row.user_id &&
              c.slug === payload.slug &&
              c.id !== row.id,
          );
          // 23505 is unique (user_id, slug).
          if (clash) return { data: null, error: { message: "dup", code: "23505" } };
          Object.assign(row, payload);
        }
        return { data: null, error: null };
      }

      if (op === "upsert") {
        if (table === "collections") {
          const exists = db.collections.some(
            (c) => c.user_id === payload.user_id && c.slug === payload.slug,
          );
          if (!exists) {
            db.nextId += 1;
            db.collections.push({
              id: `c${db.nextId}`,
              ...(payload as unknown as Omit<CollectionRecord, "id">),
            });
          }
        } else {
          const exists = db.links.some(
            (l) =>
              l.note_id === payload.note_id &&
              l.collection_id === payload.collection_id,
          );
          if (!exists) db.links.push(payload as unknown as LinkRecord);
        }
        return { data: null, error: null };
      }

      return { data: matching(), error: null };
    };

    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return chain;
      },
      delete: () => {
        op = "delete";
        return chain;
      },
      update: (values: Row) => {
        op = "update";
        payload = values;
        return chain;
      },
      upsert: (values: Row) => {
        op = "upsert";
        payload = values;
        return chain;
      },
      maybeSingle: async () => {
        const found = matching()[0];
        return { data: found ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(apply()).then(resolve),
    };

    return chain;
  };

  return {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: db.user }, error: null }),
      },
      from: (table: string) => makeChain(table),
    }),
  };
});

/** The slugs a note is filed under, read straight out of the store. */
const slugsFor = (noteId: string) =>
  db.links
    .filter((l) => l.note_id === noteId)
    .map((l) => db.collections.find((c) => c.id === l.collection_id)?.slug)
    .sort();

beforeEach(() => {
  db.collections.length = 0;
  db.links.length = 0;
  db.nextId = 0;
  db.user = { id: "u1" };
});

describe("many-to-many membership", () => {
  it("puts one note in two collections at once", async () => {
    // The constraint this whole feature is built on. A collection_id column on
    // notes would force one of these two truths to be a lie.
    expect(await addNoteToCollection("n1", "Q3 Planning")).toBe("written");
    expect(await addNoteToCollection("n1", "Hiring")).toBe("written");

    expect(slugsFor("n1")).toEqual(["hiring", "q3-planning"]);
  });

  it("removing from one collection leaves the other untouched", async () => {
    await addNoteToCollection("n1", "Q3 Planning");
    await addNoteToCollection("n1", "Hiring");

    expect(await removeNoteFromCollection("n1", "hiring")).toBe("written");

    // The delete is scoped to the pair, so exactly one membership is gone.
    expect(slugsFor("n1")).toEqual(["q3-planning"]);
    // And the collection itself survives being emptied — deleting it is a
    // different decision, made on the collections screen.
    expect(db.collections.map((c) => c.slug).sort()).toEqual([
      "hiring",
      "q3-planning",
    ]);
  });

  it("keeps two notes in the same collection independent", async () => {
    await addNoteToCollection("n1", "Q3 Planning");
    await addNoteToCollection("n2", "Q3 Planning");

    await removeNoteFromCollection("n1", "q3-planning");

    expect(slugsFor("n1")).toEqual([]);
    expect(slugsFor("n2")).toEqual(["q3-planning"]);
  });

  it("files the same note twice without a second row", async () => {
    // IDEMPOTENT BY CONSTRUCTION: on conflict do nothing against the composite
    // primary key. A read-then-write would leave a window in which two tabs
    // both see "absent" and both insert.
    await addNoteToCollection("n1", "Q3 Planning");
    await addNoteToCollection("n1", "q3 planning");

    expect(db.links).toHaveLength(1);
    expect(db.collections).toHaveLength(1);
  });
});

describe("createCollection", () => {
  it("refuses a name that normalises to nothing", async () => {
    expect(await createCollection("   ")).toBe("invalid");
    expect(db.collections).toHaveLength(0);
  });

  it("keeps what the user typed as the name and normalises the slug", async () => {
    await createCollection("Q3 Planning");
    expect(db.collections[0]).toMatchObject({
      slug: "q3-planning",
      name: "Q3 Planning",
      user_id: "u1",
    });
  });

  it("resolves an existing name to the collection already there", async () => {
    await createCollection("Q3 Planning");
    await createCollection("q3   planning");
    expect(db.collections).toHaveLength(1);
  });

  it("writes nothing when nobody is signed in", async () => {
    db.user = null;
    expect(await createCollection("Q3 Planning")).toBe("not-found");
    expect(db.collections).toHaveLength(0);
  });
});

describe("renameCollection", () => {
  it("moves the slug with the name and keeps every membership", async () => {
    await addNoteToCollection("n1", "Q3 Planning");

    expect(await renameCollection("q3-planning", "Q4 Planning")).toBe("written");

    expect(slugsFor("n1")).toEqual(["q4-planning"]);
  });

  it("reports a collision rather than merging two collections", async () => {
    // Two collections silently becoming one is data loss the user did not ask
    // for.
    await createCollection("Q3 Planning");
    await createCollection("Hiring");

    expect(await renameCollection("hiring", "Q3 Planning")).toBe("duplicate");
    expect(db.collections).toHaveLength(2);
  });

  it("reports not-found for a slug this user does not own", async () => {
    expect(await renameCollection("nobody-has-this", "Anything")).toBe(
      "not-found",
    );
  });
});

describe("deleteCollection", () => {
  it("takes its memberships and not the notes", async () => {
    await addNoteToCollection("n1", "Q3 Planning");
    await addNoteToCollection("n1", "Hiring");

    expect(await deleteCollection("hiring")).toBe("written");

    expect(db.collections.map((c) => c.slug)).toEqual(["q3-planning"]);
    // n1 is still filed in the other one. Nothing about the note changed.
    expect(slugsFor("n1")).toEqual(["q3-planning"]);
  });
});

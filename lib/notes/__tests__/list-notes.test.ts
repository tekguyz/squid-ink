import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  title: string | null;
  created_at: string;
  processing_status: string;
};
type Result = { data: Row[] | null; error: { message: string } | null };

function stubClient(result: Result) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => Promise.resolve(result),
  };
  return { from: vi.fn(() => chain) };
}

const client = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client.current,
}));

const { listNotes } = await import("../list-notes");

describe("listNotes", () => {
  beforeEach(() => {
    client.current = null;
  });

  it("maps rows to view items in the order the query returned them", async () => {
    client.current = stubClient({
      data: [
        {
          id: "note-2",
          title: "Newer",
          created_at: "2026-08-31T10:00:00Z",
          processing_status: "completed",
        },
        {
          id: "note-1",
          title: null,
          created_at: "2026-08-30T10:00:00Z",
          processing_status: "uploading",
        },
      ],
      error: null,
    });

    await expect(listNotes()).resolves.toEqual([
      {
        id: "note-2",
        title: "Newer",
        createdAt: "2026-08-31T10:00:00Z",
        processingStatus: "completed",
      },
      {
        id: "note-1",
        title: null,
        createdAt: "2026-08-30T10:00:00Z",
        processingStatus: "uploading",
      },
    ]);
  });

  it("returns an empty array when the user has no notes", async () => {
    // Also the shape a second user sees: RLS filters everything out, which
    // is an empty result rather than an error.
    client.current = stubClient({ data: [], error: null });
    await expect(listNotes()).resolves.toEqual([]);
  });

  it("returns an empty array when the query yields null data", async () => {
    client.current = stubClient({ data: null, error: null });
    await expect(listNotes()).resolves.toEqual([]);
  });

  it("throws when the query errors", async () => {
    client.current = stubClient({ data: null, error: { message: "boom" } });
    await expect(listNotes()).rejects.toThrow(/boom/);
  });

  it("orders by created_at descending, and never filters on user_id", async () => {
    // RLS supplies the ownership filter. A redundant .eq("user_id", ...) here
    // would mask an RLS failure instead of exposing it, so the query must not
    // grow one.
    const order = vi.fn(() => Promise.resolve({ data: [], error: null }));
    const eq = vi.fn();
    const select = vi.fn(() => chain);
    const chain: Record<string, unknown> = { select, order, eq };
    client.current = { from: vi.fn(() => chain) };

    await listNotes();

    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(select).toHaveBeenCalledWith(
      "id, title, created_at, processing_status",
    );
    expect(eq).not.toHaveBeenCalled();
  });
});

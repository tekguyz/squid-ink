import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: { id: string } | null; error: { message: string } | null };

function stubClient(result: Result) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(result),
  };
  return { from: vi.fn(() => chain) };
}

const client = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client.current,
}));

const { getLatestNoteId } = await import("../get-latest-note-id");

describe("getLatestNoteId", () => {
  beforeEach(() => {
    client.current = null;
  });

  it("returns the id of the most recent note", async () => {
    client.current = stubClient({ data: { id: "note-1" }, error: null });
    await expect(getLatestNoteId()).resolves.toBe("note-1");
  });

  it("returns null when the user has no notes", async () => {
    // Also the shape a second user sees: RLS filters everything out, which
    // is an empty result rather than an error.
    client.current = stubClient({ data: null, error: null });
    await expect(getLatestNoteId()).resolves.toBeNull();
  });

  it("throws when the query errors", async () => {
    client.current = stubClient({ data: null, error: { message: "boom" } });
    await expect(getLatestNoteId()).rejects.toThrow(/boom/);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersonaRow } from "../types";

type Result<T> = { data: T; error: { message: string } | null };

/** Stubs the one chain getPersonas builds:
 *    .from("personas").select(...).order(...).returns()
 *  The chain is thenable at the end, so awaiting it resolves either way. */
function stubClient(personas: Result<PersonaRow[] | null>) {
  const order = vi.fn(() => chain);
  const chain: Record<string, unknown> = {
    select: () => chain,
    order,
    returns: () => Promise.resolve(personas),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(personas).then(resolve),
  };
  return { from: vi.fn(() => chain), order };
}

const client = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client.current,
}));

const { getPersonas } = await import("../get-personas");

const row: PersonaRow = {
  id: "66666666-0000-4000-8000-000000000001",
  user_id: "79db5c35-8d50-41c9-a265-49b786994455",
  slug: "neutral-analyst",
  name: "Neutral Analyst",
  sub: "dense · no framing",
  depth: "dense",
  quick_actions: ["Extract decisions only"],
  sort_order: 0,
  created_at: "2026-08-30T00:00:00Z",
  updated_at: "2026-08-30T00:00:00Z",
};

describe("getPersonas", () => {
  beforeEach(() => {
    client.current = null;
  });

  it("returns the user's persona rows", async () => {
    client.current = stubClient({ data: [row], error: null });
    await expect(getPersonas()).resolves.toEqual([row]);
  });

  it("returns an empty array when the user has no personas", async () => {
    // RLS filters another user's rows out, so a fresh account and a foreign
    // account look alike here — never an error.
    client.current = stubClient({ data: null, error: null });
    await expect(getPersonas()).resolves.toEqual([]);
  });

  it("orders by sort_order ascending, which is rail order", async () => {
    const stub = stubClient({ data: [row], error: null });
    client.current = stub;
    await getPersonas();
    expect(stub.order).toHaveBeenCalledWith("sort_order", { ascending: true });
  });

  it("throws when the query errors", async () => {
    client.current = stubClient({ data: null, error: { message: "persona boom" } });
    await expect(getPersonas()).rejects.toThrow(/persona boom/);
  });
});

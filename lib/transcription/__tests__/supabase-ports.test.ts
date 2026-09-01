// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createTranscriptionPorts } from "@/lib/transcription/supabase-ports";

/** The factory moved out of app/api/cron/transcribe/route.ts so the cron sweep
 *  and the manual Server Action build their ports from the SAME code. These
 *  tests exist to pin the two behaviours that were only ever asserted by the
 *  live script before: the claim reports false on zero rows, and a malformed
 *  audio_storage_path throws rather than silently missing. */

const KEY = "not-a-real-gemini-key";

/** The narrowest stand-in for the PostgREST builder chain the ports use:
 *  .from(t).update(v).eq(a,b).eq(c,d).select(cols) resolves to {data,error}. */
function dbWithUpdate(result: { data: unknown[] | null; error: { message: string } | null }) {
  const eq = vi.fn();
  const chain = {
    eq: (...args: unknown[]) => {
      eq(...args);
      return chain;
    },
    select: vi.fn(async () => result),
  };
  const update = vi.fn(() => chain);
  const from = vi.fn(() => ({ update }));

  return {
    db: {
      from,
      storage: { from: () => ({}) },
    } as unknown as SupabaseClient,
    from,
    update,
    eq,
    select: chain.select,
  };
}

function dbWithList(
  result: { data: { name: string }[] | null; error: { message: string } | null },
) {
  const list = vi.fn(async () => result);
  return {
    db: {
      from: vi.fn(),
      storage: { from: () => ({ list, download: vi.fn() }) },
    } as unknown as SupabaseClient,
    list,
  };
}

describe("createTranscriptionPorts — the claim", () => {
  it("issues ONE update guarded on both the id and the expected status", async () => {
    const stub = dbWithUpdate({ data: [{ id: "note-1" }], error: null });
    const ports = createTranscriptionPorts(stub.db, KEY);

    expect(await ports.claim("note-1", "uploading", "analyzing")).toBe(true);

    expect(stub.from).toHaveBeenCalledWith("notes");
    expect(stub.update).toHaveBeenCalledTimes(1);
    expect(stub.update).toHaveBeenCalledWith({ processing_status: "analyzing" });
    expect(stub.eq.mock.calls).toEqual([
      ["id", "note-1"],
      ["processing_status", "uploading"],
    ]);
  });

  it("reports false when the guarded update matched nothing", async () => {
    const stub = dbWithUpdate({ data: [], error: null });
    const ports = createTranscriptionPorts(stub.db, KEY);

    expect(await ports.claim("note-1", "uploading", "analyzing")).toBe(false);
  });

  it("throws on a database error rather than reporting a lost race", async () => {
    const stub = dbWithUpdate({ data: null, error: { message: "boom" } });
    const ports = createTranscriptionPorts(stub.db, KEY);

    await expect(ports.claim("note-1", "uploading", "analyzing")).rejects.toThrow(
      /claim failed: boom/,
    );
  });
});

describe("createTranscriptionPorts — objectExists", () => {
  it("splits {user_id}/{note_id} and searches the prefix", async () => {
    const stub = dbWithList({ data: [{ name: "note-1" }], error: null });
    const ports = createTranscriptionPorts(stub.db, KEY);

    expect(await ports.objectExists("user-1/note-1")).toBe(true);
    expect(stub.list).toHaveBeenCalledWith("user-1", { search: "note-1" });
  });

  it("is false when the listing holds no object of that exact name", async () => {
    const stub = dbWithList({ data: [{ name: "note-2" }], error: null });
    const ports = createTranscriptionPorts(stub.db, KEY);

    expect(await ports.objectExists("user-1/note-1")).toBe(false);
  });

  it("throws on a malformed path rather than reporting 'never landed'", async () => {
    const stub = dbWithList({ data: [], error: null });
    const ports = createTranscriptionPorts(stub.db, KEY);

    await expect(ports.objectExists("no-slash-here")).rejects.toThrow(
      /must be \{user_id\}\/\{note_id\}/,
    );
    await expect(ports.objectExists("/leading")).rejects.toThrow(
      /must be \{user_id\}\/\{note_id\}/,
    );
    await expect(ports.objectExists("trailing/")).rejects.toThrow(
      /must be \{user_id\}\/\{note_id\}/,
    );
    expect(stub.list).not.toHaveBeenCalled();
  });
});

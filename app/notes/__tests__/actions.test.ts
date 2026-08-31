import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const insert = vi.fn();
const getUser = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ upsert, insert }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

const USER = "8f1c2a3b-0000-4444-8888-aaaaaaaaaaaa";
const NOTE = "11111111-2222-3333-4444-555555555555";

const input = {
  noteId: NOTE,
  audioStoragePath: `${USER}/${NOTE}`,
  durationSeconds: 754,
};

async function subject() {
  return (await import("@/app/notes/actions")).createRecordedNote;
}

describe("createRecordedNote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
    upsert.mockResolvedValue({ error: null });
  });

  it("refuses to write anything when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect((await subject())(input)).rejects.toThrow(/not signed in/i);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("writes the row with the id the object was uploaded under", async () => {
    await (await subject())(input);
    const [row] = upsert.mock.calls[0];
    expect(row.id).toBe(NOTE);
    expect(row.audio_storage_path).toBe(`${USER}/${NOTE}`);
  });

  it("sets user_id from the verified session, not from the caller's input", async () => {
    await (await subject())({ ...input, userId: "someone-else" } as never);
    expect(upsert.mock.calls[0][0].user_id).toBe(USER);
  });

  it("records the duration as whole seconds, matching the integer column", async () => {
    await (await subject())({ ...input, durationSeconds: 754.87 });
    expect(upsert.mock.calls[0][0].audio_duration_seconds).toBe(754);
  });

  it("lands on uploading — the row is written as the upload starts", async () => {
    await (await subject())(input);
    expect(upsert.mock.calls[0][0].processing_status).toBe("uploading");
  });

  it("never writes analyzing or completed — those belong to Track 3", async () => {
    await (await subject())(input);
    expect(["analyzing", "completed"]).not.toContain(
      upsert.mock.calls[0][0].processing_status,
    );
  });

  it("upserts on the primary key so a retried action is not a duplicate error", async () => {
    await (await subject())(input);
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: "id" });
  });

  // Regression guard, and the reason it exists is measured, not assumed. Run
  // against the live project: two upserts of the same id both return no error
  // and leave exactly one row, while a plain insert of the same id returns
  // 'duplicate key value violates unique constraint "notes_pkey"'. Swapping
  // upsert for insert here would therefore break every second write for a
  // given note — including any future retry of this action.
  it("never uses a plain insert, which would conflict on a repeat call", async () => {
    await (await subject())(input);
    expect(insert).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("is safe to call twice for the same note id", async () => {
    const createRecordedNote = await subject();
    await createRecordedNote(input);
    await expect(createRecordedNote(input)).resolves.toEqual({ id: NOTE });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[1][0].id).toBe(NOTE);
    expect(upsert.mock.calls[1][1]).toEqual({ onConflict: "id" });
  });

  it("revalidates the root route so the new note shows in the list", async () => {
    await (await subject())(input);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });

  it("returns the note id", async () => {
    expect(await (await subject())(input)).toEqual({ id: NOTE });
  });

  it("surfaces a database error rather than reporting success", async () => {
    upsert.mockResolvedValue({
      error: { message: "violates row-level security policy" },
    });
    await expect((await subject())(input)).rejects.toThrow(/row-level security/);
  });
});

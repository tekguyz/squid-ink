import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const insert = vi.fn();
const update = vi.fn();
const getUser = vi.fn();
const revalidatePath = vi.fn();

/** The note read that triggerTranscription does before claiming. */
const maybeSingle = vi.fn();
const selectChain = {
  eq: () => selectChain,
  maybeSingle,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ upsert, insert, update, select: () => selectChain }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

/** next/server's after(). Captured rather than executed, so a test can assert
 *  that NOTHING was scheduled on a lost claim — the cost guarantee. */
const scheduled: (() => unknown)[] = [];
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    scheduled.push(fn);
  },
}));

const claim = vi.fn();
const objectExists = vi.fn();
const transcribe = vi.fn();
vi.mock("@/lib/transcription/supabase-ports", () => ({
  createTranscriptionPorts: () => ({
    now: () => 0,
    log: vi.fn(),
    listUploading: vi.fn(),
    listStaleAnalyzing: vi.fn(),
    claim,
    objectExists,
    downloadAudio: vi.fn(async () => ({
      blob: new Blob(["x"]),
      mimeType: "audio/webm",
    })),
    transcribe,
    store: {
      deleteTranscriptChunks: vi.fn(async () => {}),
      insertChunks: vi.fn(async () => {}),
      completeNote: vi.fn(async () => true),
      markFailed: vi.fn(async () => {}),
    },
  }),
}));

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

/** The PostgREST builder is a thenable chain: .update().eq().eq().select().
 *  Every .eq() returns the same object so the guard clauses can be read back
 *  off one mock, and .select() is what actually resolves. */
function makeUpdateChain(
  result: { data: { id: string }[] | null; error: { message: string } | null } = {
    data: [{ id: NOTE }],
    error: null,
  },
) {
  const chain = {
    eq: vi.fn((_column: string, _value: unknown) => chain),
    select: vi.fn(async () => result),
  };
  return chain;
}

async function markSubject() {
  return (await import("@/app/notes/actions")).markUploadFailed;
}

/** Tier 1 of the two-tier reconciliation in docs/KNOWN_GAPS.md. Tier 2 — the
 *  cron sweep — only reaches a row after an hour, and on the Vercel Hobby daily
 *  cron that can be 24 h. This is the write the client already knows is true. */
describe("markUploadFailed", () => {
  let chain: ReturnType<typeof makeUpdateChain>;

  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
    chain = makeUpdateChain();
    update.mockReturnValue(chain);
  });

  it("refuses to write anything when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect((await markSubject())(NOTE)).rejects.toThrow(/not signed in/i);
    expect(update).not.toHaveBeenCalled();
  });

  it("writes processing_status = 'failed'", async () => {
    await (await markSubject())(NOTE);
    expect(update.mock.calls[0][0]).toEqual({ processing_status: "failed" });
  });

  it("touches no other column — not audio_storage_path, not the transcript", async () => {
    await (await markSubject())(NOTE);
    expect(Object.keys(update.mock.calls[0][0])).toEqual(["processing_status"]);
  });

  it("targets exactly one note id", async () => {
    await (await markSubject())(NOTE);
    expect(chain.eq.mock.calls).toContainEqual(["id", NOTE]);
  });

  // The same atomic-claim shape sweep.ts uses. Without it a duplicate call, or
  // a race with the cron, could flip a row that already reached 'analyzing' or
  // 'completed' back to a terminal 'failed'.
  it("guards on processing_status = 'uploading' so it cannot overwrite later work", async () => {
    await (await markSubject())(NOTE);
    expect(chain.eq.mock.calls).toContainEqual(["processing_status", "uploading"]);
  });

  it("never filters on user_id — RLS supplies the owner", async () => {
    await (await markSubject())(NOTE);
    expect(chain.eq.mock.calls.map(([column]) => column)).not.toContain("user_id");
  });

  it("is quiet when the row was already claimed and zero rows matched", async () => {
    chain = makeUpdateChain({ data: [], error: null });
    update.mockReturnValue(chain);
    await expect((await markSubject())(NOTE)).resolves.toBeUndefined();
  });

  it("surfaces a database error rather than reporting success", async () => {
    chain = makeUpdateChain({ data: null, error: { message: "offline" } });
    update.mockReturnValue(chain);
    await expect((await markSubject())(NOTE)).rejects.toThrow(/offline/);
  });

  it("revalidates the root route so the list stops showing it as uploading", async () => {
    await (await markSubject())(NOTE);
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});

describe("triggerTranscription", () => {
  const noteRow = {
    id: NOTE,
    user_id: USER,
    audio_storage_path: `${USER}/${NOTE}`,
    audio_duration_seconds: 60,
    updated_at: "2026-09-01T00:00:00Z",
  };

  async function trigger() {
    return (await import("@/app/notes/actions")).triggerTranscription;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    scheduled.length = 0;
    process.env.GEMINI_API_KEY = "not-a-real-key";
    getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
    maybeSingle.mockResolvedValue({ data: noteRow, error: null });
    objectExists.mockResolvedValue(true);
    claim.mockResolvedValue(true);
  });

  it("refuses when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect((await trigger())(NOTE)).rejects.toThrow(/not signed in/i);
    expect(claim).not.toHaveBeenCalled();
  });

  it("reports 'not-found' for a note RLS does not show this user", async () => {
    // RLS turns somebody else's note into an empty result, not an error. It
    // must read the same as a note that does not exist.
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect((await trigger())(NOTE)).resolves.toBe("not-found");
    expect(claim).not.toHaveBeenCalled();
  });

  it("claims 'uploading' -> 'analyzing' and schedules the transcription", async () => {
    await expect((await trigger())(NOTE)).resolves.toBe("started");
    expect(claim).toHaveBeenCalledWith(NOTE, "uploading", "analyzing");
    expect(scheduled).toHaveLength(1);
  });

  it("does NOT gate on age — a row hours old still claims", async () => {
    maybeSingle.mockResolvedValue({
      data: { ...noteRow, updated_at: "2020-01-01T00:00:00Z" },
      error: null,
    });
    await expect((await trigger())(NOTE)).resolves.toBe("started");
    expect(claim).toHaveBeenCalledWith(NOTE, "uploading", "analyzing");
  });

  it("schedules NOTHING when the claim matched zero rows", async () => {
    // The cost guarantee: a lost race must not reach Gemini.
    claim.mockResolvedValue(false);
    await expect((await trigger())(NOTE)).resolves.toBe("not-claimed");
    expect(scheduled).toHaveLength(0);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("fails the row with no Gemini call when the object never landed", async () => {
    objectExists.mockResolvedValue(false);
    await expect((await trigger())(NOTE)).resolves.toBe("no-audio");
    expect(claim).toHaveBeenCalledWith(NOTE, "uploading", "failed");
    expect(scheduled).toHaveLength(0);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("never reads the secret key", async () => {
    // The authenticated cookie client, full stop. RLS supplies the owner.
    // The prose above the action names the variable, so this looks for the
    // READ rather than the mention; project-conventions.test.ts holds the
    // whole-tree guard.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("app/notes/actions.ts", "utf8"),
    );
    expect(source).not.toContain("process.env.SUPABASE_SECRET_KEY");
  });
});

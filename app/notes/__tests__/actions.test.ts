import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const insert = vi.fn();
const update = vi.fn();
const getUser = vi.fn();
const revalidatePath = vi.fn();

/** One stable object identity, so a test can assert that the ports handed to
 *  the transcription pipeline were built from THIS client — the authenticated
 *  one — and not from a service-role client built inside the action. */
const authenticatedClient = {
  auth: { getUser },
  from: () => ({ upsert, insert, update }),
};

const transcribeOne = vi.fn();
const portsFor = vi.fn((_db: unknown, _key: string) => ({ marker: "ports" }));
const createServiceClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => authenticatedClient,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@supabase/supabase-js", () => ({ createClient: createServiceClient }));
vi.mock("@/lib/transcription/sweep", () => ({ transcribeOne }));
vi.mock("@/lib/transcription/supabase-ports", () => ({
  transcribePortsFor: portsFor,
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

/** The on-demand transcription trigger — docs/KNOWN_GAPS.md § "The cron sweep
 *  is the ONLY transcription trigger". The cron stays the net; this is the main
 *  path a user can press.
 *
 *  The chain here is .update().eq().in().select(), which is the SAME atomic
 *  claim shape sweep.ts uses, only with two acceptable source states instead of
 *  one. Everything after a successful claim is sweep.ts's own transcribeOne —
 *  mocked here so this file tests the claim, not Gemini. */
function makeClaimChain(
  result: { data: unknown[] | null; error: { message: string } | null } = {
    data: [
      {
        id: NOTE,
        user_id: USER,
        audio_storage_path: `${USER}/${NOTE}`,
        audio_duration_seconds: 754,
      },
    ],
    error: null,
  },
) {
  const chain = {
    eq: vi.fn((_column: string, _value: unknown) => chain),
    in: vi.fn((_column: string, _values: unknown[]) => chain),
    select: vi.fn(async () => result),
  };
  return chain;
}

describe("transcribeNote", () => {
  let chain: ReturnType<typeof makeClaimChain>;

  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
    chain = makeClaimChain();
    update.mockReturnValue(chain);
    transcribeOne.mockResolvedValue("transcribed");
    process.env.GEMINI_API_KEY = "test-key";
  });

  async function subject() {
    return (await import("@/app/notes/actions")).transcribeNote;
  }

  it("refuses to write anything when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect((await subject())(NOTE)).rejects.toThrow(/not signed in/i);
    expect(update).not.toHaveBeenCalled();
  });

  it("claims the row by writing processing_status = 'analyzing'", async () => {
    await (await subject())(NOTE);
    expect(update.mock.calls[0][0]).toEqual({ processing_status: "analyzing" });
  });

  it("touches no other column while claiming", async () => {
    await (await subject())(NOTE);
    expect(Object.keys(update.mock.calls[0][0])).toEqual(["processing_status"]);
  });

  it("targets exactly one note id", async () => {
    await (await subject())(NOTE);
    expect(chain.eq.mock.calls).toContainEqual(["id", NOTE]);
  });

  // THE load-bearing guard. It is what stops this action and a concurrent cron
  // sweep both claiming the same row: Postgres row-locks the matched row, so
  // whichever statement runs second re-evaluates this predicate against the
  // already-updated value and matches nothing.
  it("only claims a row that is still 'uploading' or 'failed'", async () => {
    await (await subject())(NOTE);
    expect(chain.in.mock.calls).toEqual([
      ["processing_status", ["uploading", "failed"]],
    ]);
  });

  it("never claims a 'completed' or 'analyzing' row", async () => {
    await (await subject())(NOTE);
    const [, values] = chain.in.mock.calls[0] as [string, string[]];
    expect(values).not.toContain("completed");
    expect(values).not.toContain("analyzing");
  });

  it("never filters on user_id — RLS supplies the owner", async () => {
    await (await subject())(NOTE);
    expect(chain.eq.mock.calls.map(([column]) => column)).not.toContain("user_id");
  });

  it("uses the authenticated server client, never the secret key", async () => {
    await (await subject())(NOTE);
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(portsFor.mock.calls[0][0]).toBe(authenticatedClient);
  });

  it("reports 'not-eligible' rather than throwing when zero rows matched", async () => {
    chain = makeClaimChain({ data: [], error: null });
    update.mockReturnValue(chain);
    await expect((await subject())(NOTE)).resolves.toEqual({
      status: "not-eligible",
    });
  });

  it("spends no Gemini call when the claim matched nothing", async () => {
    chain = makeClaimChain({ data: [], error: null });
    update.mockReturnValue(chain);
    await (await subject())(NOTE);
    expect(transcribeOne).not.toHaveBeenCalled();
  });

  it("hands the claimed row straight to sweep.ts's transcribeOne", async () => {
    await (await subject())(NOTE);
    expect(transcribeOne.mock.calls[0][1]).toMatchObject({
      id: NOTE,
      user_id: USER,
      audio_storage_path: `${USER}/${NOTE}`,
      audio_duration_seconds: 754,
    });
  });

  it("reports success when the transcription completed", async () => {
    await expect((await subject())(NOTE)).resolves.toEqual({
      status: "transcribed",
    });
  });

  it("reports failure without throwing when the transcription failed", async () => {
    transcribeOne.mockResolvedValue("failed");
    await expect((await subject())(NOTE)).resolves.toEqual({ status: "failed" });
  });

  it("revalidates the note's own route so the transcript renders", async () => {
    await (await subject())(NOTE);
    expect(revalidatePath).toHaveBeenCalledWith(`/notes/${NOTE}`);
  });

  it("surfaces a database error rather than reporting success", async () => {
    chain = makeClaimChain({ data: null, error: { message: "offline" } });
    update.mockReturnValue(chain);
    await expect((await subject())(NOTE)).rejects.toThrow(/offline/);
  });

  it("refuses before claiming when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect((await subject())(NOTE)).rejects.toThrow(/GEMINI_API_KEY/);
    expect(update).not.toHaveBeenCalled();
  });
});

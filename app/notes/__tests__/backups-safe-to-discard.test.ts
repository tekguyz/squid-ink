import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAILED_BACKUP_TTL_MS } from "@/lib/recorder/backup-cleanup";

const getUser = vi.fn();
const select = vi.fn();
const inQuery = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ select }),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const USER = "8f1c2a3b-0000-4444-8888-aaaaaaaaaaaa";
const DONE = "11111111-1111-4111-8111-111111111111";
const OLD_FAIL = "22222222-2222-4222-8222-222222222222";
const NEW_FAIL = "33333333-3333-4333-8333-333333333333";
const UPLOADING = "44444444-4444-4444-8444-444444444444";

const iso = (ms: number) => new Date(ms).toISOString();

async function subject() {
  return (await import("@/app/notes/actions/recording")).backupsSafeToDiscard;
}

/** The server decides against ITS clock and the row's own updated_at, so the
 *  browser's clock never enters into when audio is deleted. */
describe("backupsSafeToDiscard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
    select.mockReturnValue({ in: inQuery });
    const now = Date.now();
    inQuery.mockResolvedValue({
      data: [
        { id: DONE, processing_status: "completed", updated_at: iso(now) },
        { id: OLD_FAIL, processing_status: "failed", updated_at: iso(now - FAILED_BACKUP_TTL_MS - 60_000) },
        { id: NEW_FAIL, processing_status: "failed", updated_at: iso(now - 60_000) },
        { id: UPLOADING, processing_status: "uploading", updated_at: iso(0) },
      ],
      error: null,
    });
  });

  it("names completed notes and failed notes past seven days, and nothing else", async () => {
    const ids = [DONE, OLD_FAIL, NEW_FAIL, UPLOADING];
    expect(await (await subject())(ids)).toEqual([DONE, OLD_FAIL]);
    expect(inQuery).toHaveBeenCalledWith("id", ids);
  });

  it("reads only the columns the rule needs", async () => {
    await (await subject())([DONE]);
    expect(select).toHaveBeenCalledWith("id, processing_status, updated_at");
  });

  it("returns nothing with no session, rather than throwing on every signed-out page load", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect((await subject())([DONE])).resolves.toEqual([]);
    expect(select).not.toHaveBeenCalled();
  });

  it("drops anything that is not a uuid before it reaches the query", async () => {
    await (await subject())([DONE, "not-a-uuid"]);
    expect(inQuery).toHaveBeenCalledWith("id", [DONE]);
  });

  it("surfaces a database error rather than deleting on a guess", async () => {
    inQuery.mockResolvedValue({ data: null, error: { message: "offline" } });
    await expect((await subject())([DONE])).rejects.toThrow(/offline/);
  });
});

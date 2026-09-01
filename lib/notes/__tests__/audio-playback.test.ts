import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadNoteAudio, type PlaybackStorage } from "@/lib/notes/audio-playback";

const USER = "8f1c2a3b-0000-4444-8888-aaaaaaaaaaaa";
const NOTE = "11111111-2222-3333-4444-555555555555";
const PATH = `${USER}/${NOTE}`;

const createObjectURL = vi.fn(() => "blob:fake-url");
const revokeObjectURL = vi.fn();

/** Storage always hands download() a Blob typed application/octet-stream,
 *  whatever was uploaded — the same measurement that made the cron route read
 *  list() metadata first. The fake reproduces that, so the tests fail if the
 *  helper ever trusts the Blob. */
function fakeStorage(overrides: Partial<PlaybackStorage> = {}): PlaybackStorage {
  return {
    list: vi.fn(async () => ({
      data: [{ name: NOTE, metadata: { mimetype: "audio/webm;codecs=opus" } }],
      error: null,
    })),
    download: vi.fn(async () => ({
      data: new Blob(["audio"], { type: "application/octet-stream" }),
      error: null,
    })),
    ...overrides,
  };
}

describe("loadNoteAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
  });
  afterEach(() => vi.clearAllMocks());

  it("lists the user's folder and searches for the note id", async () => {
    const storage = fakeStorage();
    await loadNoteAudio(PATH, storage);
    expect(storage.list).toHaveBeenCalledWith(USER, { search: NOTE });
  });

  it("downloads the object at the exact two-segment path", async () => {
    const storage = fakeStorage();
    await loadNoteAudio(PATH, storage);
    expect(storage.download).toHaveBeenCalledWith(PATH);
  });

  it("returns null when the object is not there — a failed row has no audio", async () => {
    const storage = fakeStorage({
      list: vi.fn(async () => ({ data: [], error: null })),
    });
    expect(await loadNoteAudio(PATH, storage)).toBeNull();
    expect(storage.download).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it("prefers the object's own metadata over the Blob's octet-stream type", async () => {
    const loaded = await loadNoteAudio(PATH, fakeStorage());
    expect(loaded?.mimeType).toBe("audio/webm");
  });

  it("falls back to a playable container when no candidate names one", async () => {
    const storage = fakeStorage({
      list: vi.fn(async () => ({
        data: [{ name: NOTE, metadata: { mimetype: "application/octet-stream" } }],
        error: null,
      })),
    });
    expect((await loadNoteAudio(PATH, storage))?.mimeType).toBe("audio/webm");
  });

  it("creates the object URL only after the bytes have arrived", async () => {
    const order: string[] = [];
    const storage = fakeStorage({
      download: vi.fn(async () => {
        order.push("download");
        return { data: new Blob(["a"]), error: null };
      }),
    });
    createObjectURL.mockImplementation(() => {
      order.push("createObjectURL");
      return "blob:fake-url";
    });
    const loaded = await loadNoteAudio(PATH, storage);
    expect(order).toEqual(["download", "createObjectURL"]);
    expect(loaded?.url).toBe("blob:fake-url");
  });

  it("revokes exactly the URL it created", async () => {
    const loaded = await loadNoteAudio(PATH, fakeStorage());
    loaded?.revoke();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });

  it("surfaces a download error rather than pretending the audio is missing", async () => {
    const storage = fakeStorage({
      download: vi.fn(async () => ({ data: null, error: { message: "boom" } })),
    });
    await expect(loadNoteAudio(PATH, storage)).rejects.toThrow(/boom/);
  });

  it("surfaces a list error rather than pretending the audio is missing", async () => {
    const storage = fakeStorage({
      list: vi.fn(async () => ({ data: null, error: { message: "denied" } })),
    });
    await expect(loadNoteAudio(PATH, storage)).rejects.toThrow(/denied/);
  });
});

import { describe, expect, it, vi } from "vitest";
import { AUDIO_BUCKET, recordingPath, uploadRecording } from "@/lib/recorder/upload-audio";

const USER = "8f1c2a3b-0000-4444-8888-aaaaaaaaaaaa";
const NOTE = "11111111-2222-3333-4444-555555555555";

function bucket(over: Record<string, unknown> = {}) {
  return {
    upload: vi.fn(async () => ({ data: { path: `${USER}/${NOTE}` }, error: null })),
    list: vi.fn(async () => ({
      data: [{ name: NOTE, metadata: { size: 1234 } }],
      error: null,
    })),
    ...over,
  };
}

describe("recordingPath", () => {
  it("is exactly {user_id}/{note_id} — the shape the RLS policy checks", () => {
    expect(recordingPath(USER, NOTE)).toBe(`${USER}/${NOTE}`);
  });

  it("puts the user id in the first folder segment", () => {
    expect(recordingPath(USER, NOTE).split("/")[0]).toBe(USER);
  });

  it("adds no extension, so the object name is the bare note id", () => {
    expect(recordingPath(USER, NOTE).split("/")[1]).toBe(NOTE);
  });

  it("names the bucket the Track 1 policies were written for", () => {
    expect(AUDIO_BUCKET).toBe("audio-recordings");
  });
});

describe("uploadRecording", () => {
  const blob = new Blob(["x".repeat(1234)], { type: "audio/webm" });

  it("uploads to the owner-scoped path with upsert on", async () => {
    const b = bucket();
    await uploadRecording({
      bucket: b as never,
      userId: USER,
      noteId: NOTE,
      blob,
      contentType: "audio/webm;codecs=opus",
    });
    expect(b.upload).toHaveBeenCalledWith(`${USER}/${NOTE}`, blob, {
      contentType: "audio/webm;codecs=opus",
      upsert: true,
    });
  });

  it("reports the size from list() metadata", async () => {
    const result = await uploadRecording({
      bucket: bucket() as never,
      userId: USER,
      noteId: NOTE,
      blob,
      contentType: "audio/webm",
    });
    expect(result).toEqual({ path: `${USER}/${NOTE}`, sizeBytes: 1234 });
  });

  it("never calls download — a read straight after an upsert is CDN-stale", async () => {
    const download = vi.fn();
    await uploadRecording({
      bucket: bucket({ download }) as never,
      userId: USER,
      noteId: NOTE,
      blob,
      contentType: "audio/webm",
    });
    expect(download).not.toHaveBeenCalled();
  });

  it("throws with the Storage message when the upload is refused", async () => {
    const b = bucket({
      upload: vi.fn(async () => ({
        data: null,
        error: { message: "new row violates row-level security policy" },
      })),
    });
    await expect(
      uploadRecording({
        bucket: b as never,
        userId: USER,
        noteId: NOTE,
        blob,
        contentType: "audio/webm",
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it("throws when the object cannot be found in the listing afterwards", async () => {
    const b = bucket({ list: vi.fn(async () => ({ data: [], error: null })) });
    await expect(
      uploadRecording({
        bucket: b as never,
        userId: USER,
        noteId: NOTE,
        blob,
        contentType: "audio/webm",
      }),
    ).rejects.toThrow(/not visible/i);
  });

  it("lists inside the user's own prefix, never the bucket root", async () => {
    const b = bucket();
    await uploadRecording({
      bucket: b as never,
      userId: USER,
      noteId: NOTE,
      blob,
      contentType: "audio/webm",
    });
    expect(b.list).toHaveBeenCalledWith(USER, { search: NOTE });
  });
});

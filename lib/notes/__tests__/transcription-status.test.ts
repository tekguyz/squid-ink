import { describe, expect, it, vi } from "vitest";
import {
  readNoteProgress,
  type StatusReader,
} from "@/lib/notes/transcription-status";

const NOTE = "11111111-2222-3333-4444-555555555555";

type Row = { processing_status: string; notegen_status: string | null };

function reader(result: {
  data: Row | null;
  error: { message: string } | null;
}) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { reader: { from } as unknown as StatusReader, from, select, eq };
}

describe("readNoteProgress", () => {
  it("returns both statuses from one row", async () => {
    const stub = reader({
      data: { processing_status: "completed", notegen_status: "generating" },
      error: null,
    });

    await expect(readNoteProgress(NOTE, stub.reader)).resolves.toEqual({
      processing: "completed",
      notegen: "generating",
    });

    expect(stub.from).toHaveBeenCalledWith("notes");
    expect(stub.select).toHaveBeenCalledWith("processing_status, notegen_status");
    expect(stub.eq).toHaveBeenCalledWith("id", NOTE);
  });

  it("passes a null notegen_status through as null, not as done", async () => {
    const stub = reader({
      data: { processing_status: "completed", notegen_status: null },
      error: null,
    });
    await expect(readNoteProgress(NOTE, stub.reader)).resolves.toEqual({
      processing: "completed",
      notegen: null,
    });
  });

  it("returns null when RLS shows the caller no row", async () => {
    // Somebody else's note is an empty result, not an error, and must read the
    // same as a note that does not exist.
    const stub = reader({ data: null, error: null });
    await expect(readNoteProgress(NOTE, stub.reader)).resolves.toBeNull();
  });

  it("throws on a transport failure rather than looking like 'still working'", async () => {
    const stub = reader({ data: null, error: { message: "network down" } });
    await expect(readNoteProgress(NOTE, stub.reader)).rejects.toThrow(
      /network down/,
    );
  });

  it("throws on a processing status the app has no case for", async () => {
    // A value added to notes_processing_status_check in SQL but not to
    // ProcessingStatus would otherwise read as "still analyzing" forever.
    const stub = reader({
      data: { processing_status: "summarising", notegen_status: null },
      error: null,
    });
    await expect(readNoteProgress(NOTE, stub.reader)).rejects.toThrow(
      /unknown processing_status "summarising"/i,
    );
  });

  it("throws on a notegen status the app has no case for", async () => {
    // Same rule: an unknown value must not read as "still writing" forever.
    const stub = reader({
      data: { processing_status: "completed", notegen_status: "queued" },
      error: null,
    });
    await expect(readNoteProgress(NOTE, stub.reader)).rejects.toThrow(
      /unknown notegen_status "queued"/i,
    );
  });

  it("never filters on user_id — RLS supplies ownership", async () => {
    const stub = reader({
      data: { processing_status: "uploading", notegen_status: null },
      error: null,
    });
    await readNoteProgress(NOTE, stub.reader);

    // A redundant application filter would mask an RLS failure instead of
    // exposing it. Exactly one eq, and it is the id.
    expect(stub.eq.mock.calls).toEqual([["id", NOTE]]);
  });
});

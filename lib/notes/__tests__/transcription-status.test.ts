import { describe, expect, it, vi } from "vitest";
import {
  readProcessingStatus,
  type StatusReader,
} from "@/lib/notes/transcription-status";

const NOTE = "11111111-2222-3333-4444-555555555555";

function reader(result: {
  data: { processing_status: string } | null;
  error: { message: string } | null;
}) {
  const maybeSingle = vi.fn(async () => result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { reader: { from } as unknown as StatusReader, from, select, eq };
}

describe("readProcessingStatus", () => {
  it("returns the row's status", async () => {
    const stub = reader({ data: { processing_status: "analyzing" }, error: null });

    await expect(readProcessingStatus(NOTE, stub.reader)).resolves.toBe(
      "analyzing",
    );

    expect(stub.from).toHaveBeenCalledWith("notes");
    expect(stub.select).toHaveBeenCalledWith("processing_status");
    expect(stub.eq).toHaveBeenCalledWith("id", NOTE);
  });

  it("returns null when RLS shows the caller no row", async () => {
    // Somebody else's note is an empty result, not an error, and must read the
    // same as a note that does not exist.
    const stub = reader({ data: null, error: null });
    await expect(readProcessingStatus(NOTE, stub.reader)).resolves.toBeNull();
  });

  it("throws on a transport failure rather than looking like 'still working'", async () => {
    const stub = reader({ data: null, error: { message: "network down" } });
    await expect(readProcessingStatus(NOTE, stub.reader)).rejects.toThrow(
      /network down/,
    );
  });

  it("throws on a status the app has no case for", async () => {
    // A value added to notes_processing_status_check in SQL but not to
    // ProcessingStatus would otherwise flow through as a valid one and reach
    // the polling component's fallthrough, reading as "still analyzing"
    // forever. Same rule as the transport failure above: quietly broken must
    // not look like quietly working.
    const stub = reader({ data: { processing_status: "summarising" }, error: null });
    await expect(readProcessingStatus(NOTE, stub.reader)).rejects.toThrow(
      /unknown processing_status "summarising"/i,
    );
  });

  it("never filters on user_id — RLS supplies ownership", async () => {
    const stub = reader({ data: { processing_status: "uploading" }, error: null });
    await readProcessingStatus(NOTE, stub.reader);

    // A redundant application filter would mask an RLS failure instead of
    // exposing it. Exactly one eq, and it is the id.
    expect(stub.eq.mock.calls).toEqual([["id", NOTE]]);
  });
});

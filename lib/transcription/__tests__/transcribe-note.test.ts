// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  claimAndTranscribe,
  claimNoteForTranscription,
  transcribeClaimedNote,
} from "@/lib/transcription/transcribe-note";
import type { SweepPorts, UploadingRow } from "@/lib/transcription/sweep";

/** The per-row unit both callers share: the cron sweep and the manual
 *  Transcribe Server Action. The whole point of these tests is the cost
 *  guarantee — a lost claim must never reach ports.transcribe. */

const NOW = 1_800_000_000_000;
const USER = "22222222-2222-2222-2222-222222222222";

function row(overrides: Partial<UploadingRow> = {}): UploadingRow {
  const id = overrides.id ?? "note-1";
  return {
    id,
    user_id: USER,
    audio_storage_path: `${USER}/${id}`,
    audio_duration_seconds: 60,
    updated_at: new Date(NOW - 1000).toISOString(),
    ...overrides,
  };
}

function ports(overrides: Partial<SweepPorts> = {}): SweepPorts {
  return {
    now: () => NOW,
    log: vi.fn(),
    listUploading: vi.fn(async () => []),
    listStaleAnalyzing: vi.fn(async () => []),
    claim: vi.fn(async () => true),
    objectExists: vi.fn(async () => true),
    downloadAudio: vi.fn(async () => ({
      blob: new Blob(["x"]),
      mimeType: "audio/webm",
    })),
    transcribe: vi.fn(async () => ({
      rawTranscript: "hello",
      diarized: true,
      segments: [
        { speakerLabel: "spk_1", startSeconds: 0, endSeconds: 1, text: "hello" },
      ],
    })),
    store: {
      deleteTranscriptChunks: vi.fn(async () => {}),
      insertChunks: vi.fn(async () => {}),
      completeNote: vi.fn(async () => true),
      markFailed: vi.fn(async () => {}),
    },
    ...overrides,
  };
}

describe("claimNoteForTranscription", () => {
  it("claims 'uploading' -> 'analyzing' when the object is there", async () => {
    const p = ports();

    expect(
      await claimNoteForTranscription(p, row(), { failOnMissingObject: true }),
    ).toBe("claimed");

    expect(p.objectExists).toHaveBeenCalledWith(`${USER}/note-1`);
    expect(p.claim).toHaveBeenCalledWith("note-1", "uploading", "analyzing");
  });

  it("returns 'contended' when the claim matched zero rows", async () => {
    const p = ports({ claim: vi.fn(async () => false) });

    expect(
      await claimNoteForTranscription(p, row(), { failOnMissingObject: true }),
    ).toBe("contended");
  });

  it("leaves the row alone when the object is absent and failure is not terminal", async () => {
    const p = ports({ objectExists: vi.fn(async () => false) });

    expect(
      await claimNoteForTranscription(p, row(), { failOnMissingObject: false }),
    ).toBe("waiting");

    expect(p.claim).not.toHaveBeenCalled();
  });

  it("fails the row when the object is absent and failure IS terminal", async () => {
    const p = ports({ objectExists: vi.fn(async () => false) });

    expect(
      await claimNoteForTranscription(p, row(), { failOnMissingObject: true }),
    ).toBe("no-object");

    expect(p.claim).toHaveBeenCalledWith("note-1", "uploading", "failed");
  });

  it("treats a row with no audio_storage_path as an absent object", async () => {
    const p = ports();

    expect(
      await claimNoteForTranscription(p, row({ audio_storage_path: null }), {
        failOnMissingObject: true,
      }),
    ).toBe("no-object");

    expect(p.objectExists).not.toHaveBeenCalled();
    expect(p.claim).toHaveBeenCalledWith("note-1", "uploading", "failed");
  });

  it("reports 'contended' when even the failure claim is lost", async () => {
    const p = ports({
      objectExists: vi.fn(async () => false),
      claim: vi.fn(async () => false),
    });

    expect(
      await claimNoteForTranscription(p, row(), { failOnMissingObject: true }),
    ).toBe("contended");
  });
});

describe("claimAndTranscribe — the cost guarantee", () => {
  it("never calls Gemini when the claim is lost", async () => {
    const p = ports({ claim: vi.fn(async () => false) });

    expect(
      await claimAndTranscribe(p, row(), { failOnMissingObject: true }),
    ).toBe("contended");

    expect(p.transcribe).not.toHaveBeenCalled();
    expect(p.downloadAudio).not.toHaveBeenCalled();
  });

  it("never calls Gemini when the object is missing", async () => {
    const p = ports({ objectExists: vi.fn(async () => false) });

    expect(
      await claimAndTranscribe(p, row(), { failOnMissingObject: true }),
    ).toBe("no-object");

    expect(p.transcribe).not.toHaveBeenCalled();
  });

  it("lets exactly one of two concurrent callers transcribe the same row", async () => {
    // One shared boolean standing in for the row lock: the first UPDATE to
    // match wins, every later one matches nothing.
    let taken = false;
    const claim = vi.fn(async () => {
      if (taken) return false;
      taken = true;
      return true;
    });

    const p = ports({ claim });
    const target = row();

    const outcomes = await Promise.all([
      claimAndTranscribe(p, target, { failOnMissingObject: true }),
      claimAndTranscribe(p, target, { failOnMissingObject: true }),
    ]);

    expect(outcomes.filter((o) => o === "transcribed")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "contended")).toHaveLength(1);
    expect(p.transcribe).toHaveBeenCalledTimes(1);
  });

  it("transcribes and completes on the happy path", async () => {
    const p = ports();

    expect(
      await claimAndTranscribe(p, row(), { failOnMissingObject: true }),
    ).toBe("transcribed");

    expect(p.store.completeNote).toHaveBeenCalled();
  });
});

describe("transcribeClaimedNote", () => {
  it("refuses a recording past the plain cap with no Gemini call", async () => {
    const p = ports();

    expect(
      await transcribeClaimedNote(p, row({ audio_duration_seconds: 61 * 60 })),
    ).toBe("failed");

    expect(p.transcribe).not.toHaveBeenCalled();
    expect(p.store.markFailed).toHaveBeenCalled();
  });

  it("marks the note failed when Gemini throws", async () => {
    const p = ports({
      transcribe: vi.fn(async () => {
        throw new Error("gemini exploded");
      }),
    });

    expect(await transcribeClaimedNote(p, row())).toBe("failed");
    expect(p.store.markFailed).toHaveBeenCalledWith("note-1", "gemini exploded");
  });
});

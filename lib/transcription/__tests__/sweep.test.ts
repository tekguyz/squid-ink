// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import {
  sweep,
  STALE_AFTER_MS,
  MAX_TRANSCRIPTIONS_PER_RUN,
  type SweepPorts,
  type UploadingRow,
} from "@/lib/transcription/sweep";

const NOW = 1_800_000_000_000;
const USER = "22222222-2222-2222-2222-222222222222";

function row(overrides: Partial<UploadingRow> = {}): UploadingRow {
  return {
    id: "note-1",
    user_id: USER,
    audio_storage_path: `${USER}/note-1`,
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

describe("sweep — the happy path", () => {
  it("claims 'uploading' -> 'analyzing', transcribes, and completes", async () => {
    const p = ports({ listUploading: vi.fn(async () => [row()]) });
    const report = await sweep(p);

    expect(p.claim).toHaveBeenCalledWith("note-1", "uploading", "analyzing");
    expect(p.transcribe).toHaveBeenCalledTimes(1);
    expect(p.store.completeNote).toHaveBeenCalledTimes(1);
    expect(report.transcribed).toBe(1);
  });

  it("diarizes a short recording and not a long one", async () => {
    const short = ports({
      listUploading: vi.fn(async () => [row({ audio_duration_seconds: 27 * 60 })]),
    });
    await sweep(short);
    expect(short.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ diarize: true }),
    );

    const long = ports({
      listUploading: vi.fn(async () => [row({ audio_duration_seconds: 29 * 60 })]),
    });
    await sweep(long);
    expect(long.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ diarize: false }),
    );
  });
});

describe("sweep — the atomic claim", () => {
  it("does not transcribe when the claim is lost to a concurrent tick", async () => {
    // Two overlapping invocations see the same row. Only the UPDATE whose
    // WHERE still matches wins; the loser must not spend a Gemini call.
    const p = ports({
      listUploading: vi.fn(async () => [row()]),
      claim: vi.fn(async () => false),
    });
    const report = await sweep(p);

    expect(p.transcribe).not.toHaveBeenCalled();
    expect(report.transcribed).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it("lets exactly one of two concurrent sweeps claim the same row", async () => {
    let claimed = false;
    const claim = vi.fn(async () => {
      if (claimed) return false;
      claimed = true;
      return true;
    });

    const a = ports({ listUploading: vi.fn(async () => [row()]), claim });
    const b = ports({ listUploading: vi.fn(async () => [row()]), claim });

    const [ra, rb] = await Promise.all([sweep(a), sweep(b)]);

    expect(ra.transcribed + rb.transcribed).toBe(1);
    // vi.mocked() is a type-only cast. ports() is typed as SweepPorts, and
    // tsconfig.json includes **/*.ts under strict, so reaching for .mock
    // directly would not typecheck.
    expect(
      vi.mocked(a.transcribe).mock.calls.length +
        vi.mocked(b.transcribe).mock.calls.length,
    ).toBe(1);
  });
});

describe("sweep — a missing Storage object", () => {
  it("leaves a young row alone when the object is absent", async () => {
    const p = ports({
      listUploading: vi.fn(async () => [
        row({ updated_at: new Date(NOW - (STALE_AFTER_MS - 1000)).toISOString() }),
      ]),
      objectExists: vi.fn(async () => false),
    });
    const report = await sweep(p);

    expect(p.claim).not.toHaveBeenCalled();
    expect(report.failed).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it("fails a row past the hour when the object is absent", async () => {
    const p = ports({
      listUploading: vi.fn(async () => [
        row({ updated_at: new Date(NOW - (STALE_AFTER_MS + 1000)).toISOString() }),
      ]),
      objectExists: vi.fn(async () => false),
    });
    const report = await sweep(p);

    expect(p.claim).toHaveBeenCalledWith("note-1", "uploading", "failed");
    expect(report.failed).toBe(1);
  });

  it("transcribes a row past the hour when the object IS present", async () => {
    // Age alone never fails a row. The safety check is object existence — an
    // old row with audio behind it is a lost write-back, not a lost upload.
    const p = ports({
      listUploading: vi.fn(async () => [
        row({ updated_at: new Date(NOW - STALE_AFTER_MS * 10).toISOString() }),
      ]),
    });
    const report = await sweep(p);

    expect(report.transcribed).toBe(1);
    expect(report.failed).toBe(0);
  });

  it("fails a row with no audio_storage_path at all, once stale", async () => {
    const p = ports({
      listUploading: vi.fn(async () => [
        row({
          audio_storage_path: null,
          updated_at: new Date(NOW - (STALE_AFTER_MS + 1)).toISOString(),
        }),
      ]),
    });
    const report = await sweep(p);

    expect(p.objectExists).not.toHaveBeenCalled();
    expect(report.failed).toBe(1);
  });
});

describe("sweep — a stale 'analyzing' row", () => {
  it("fails one past the hour", async () => {
    const p = ports({ listStaleAnalyzing: vi.fn(async () => ["crashed-note"]) });
    const report = await sweep(p);

    expect(p.claim).toHaveBeenCalledWith("crashed-note", "analyzing", "failed");
    expect(report.reconciled).toBe(1);
  });

  it("asks the database for the cutoff rather than filtering in memory", async () => {
    const p = ports();
    await sweep(p);

    expect(p.listStaleAnalyzing).toHaveBeenCalledWith(
      new Date(NOW - STALE_AFTER_MS).toISOString(),
      expect.any(Number),
    );
  });

  it("counts nothing when the claim is lost", async () => {
    const p = ports({
      listStaleAnalyzing: vi.fn(async () => ["crashed-note"]),
      claim: vi.fn(async () => false),
    });

    expect((await sweep(p)).reconciled).toBe(0);
  });
});

describe("sweep — recordings past Gemini's cap", () => {
  it("fails outright, with no Gemini call and a reason in the log", async () => {
    const p = ports({
      listUploading: vi.fn(async () => [row({ audio_duration_seconds: 61 * 60 })]),
    });
    const report = await sweep(p);

    expect(p.transcribe).not.toHaveBeenCalled();
    expect(p.store.markFailed).toHaveBeenCalledWith(
      "note-1",
      expect.stringContaining("segmentation is not implemented"),
    );
    expect(report.failed).toBe(1);
  });
});

describe("sweep — failure handling", () => {
  it("marks the note failed when Gemini throws, and keeps going", async () => {
    const p = ports({
      listUploading: vi.fn(async () => [row(), row({ id: "note-2" })]),
      transcribe: vi
        .fn()
        .mockRejectedValueOnce(new Error("gemini exploded"))
        .mockResolvedValue({ rawTranscript: "ok", diarized: false, segments: [] }),
    });
    const report = await sweep(p);

    expect(p.store.markFailed).toHaveBeenCalledWith(
      "note-1",
      expect.stringContaining("gemini exploded"),
    );
    expect(report.failed).toBe(1);
    expect(report.transcribed).toBe(1);
  });
});

describe("sweep — caps", () => {
  it("never transcribes more rows than the per-run cap", async () => {
    const many = Array.from({ length: 10 }, (_, i) => row({ id: `note-${i}` }));
    const p = ports({ listUploading: vi.fn(async () => many) });
    const report = await sweep(p);

    expect(report.transcribed).toBe(MAX_TRANSCRIPTIONS_PER_RUN);
    expect(p.transcribe).toHaveBeenCalledTimes(MAX_TRANSCRIPTIONS_PER_RUN);
  });

  it("logs what it dropped rather than reporting silent completeness", async () => {
    const many = Array.from({ length: 10 }, (_, i) => row({ id: `note-${i}` }));
    const log = vi.fn();
    await sweep(ports({ listUploading: vi.fn(async () => many), log }));

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/deferred|remaining/i));
  });

  it("stops claiming new work once the wall-clock budget is spent", async () => {
    let clock = NOW;
    const p = ports({
      now: () => clock,
      listUploading: vi.fn(async () => [row(), row({ id: "note-2" })]),
      transcribe: vi.fn(async () => {
        clock += 300_000; // blow the budget inside the first transcription
        return { rawTranscript: "ok", diarized: false, segments: [] };
      }),
    });
    const report = await sweep(p);

    expect(report.transcribed).toBe(1);
    expect(p.transcribe).toHaveBeenCalledTimes(1);
  });
});

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
  const id = overrides.id ?? "note-1";
  return {
    id,
    user_id: USER,
    // Derived from the id, so a test that gives two rows different ids also
    // gives them different Storage paths — which is what lets objectExists be
    // stubbed per row.
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
    expect(report.contended).toBe(1);
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
    // 'waiting', not 'deferred' — nothing was pushed aside by a cap. The
    // upload simply has not landed yet, and the report must not read like a
    // backlog when the system is idle and healthy.
    expect(report.waiting).toBe(1);
    expect(report.deferred).toBe(0);
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

  it("records a lost claim on the stale-orphan path rather than dropping it", async () => {
    // Every other branch increments something. A silent fall-through here
    // would make a contended run indistinguishable from an empty one.
    const p = ports({
      listUploading: vi.fn(async () => [
        row({ updated_at: new Date(NOW - (STALE_AFTER_MS + 1)).toISOString() }),
      ]),
      objectExists: vi.fn(async () => false),
      claim: vi.fn(async () => false),
    });
    const report = await sweep(p);

    expect(report.failed).toBe(0);
    expect(report.contended).toBe(1);
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

  it("caps ATTEMPTS, not successes — a failing run must not call Gemini forever", async () => {
    // The cap is sized against the 300 s Hobby ceiling, and a failing call is
    // the EXPENSIVE case (a timeout burns the most wall-clock). Counting only
    // successes left the cap inoperative in exactly the scenario it exists for.
    const many = Array.from({ length: 10 }, (_, i) => row({ id: `note-${i}` }));
    const p = ports({
      listUploading: vi.fn(async () => many),
      transcribe: vi.fn(async () => {
        throw new Error("gemini timeout");
      }),
    });
    const report = await sweep(p);

    expect(p.transcribe).toHaveBeenCalledTimes(MAX_TRANSCRIPTIONS_PER_RUN);
    expect(report.failed).toBe(MAX_TRANSCRIPTIONS_PER_RUN);
    expect(report.transcribed).toBe(0);
  });

  it("counts a cheap stale-orphan failure against the cap not at all", async () => {
    // Marking a stale orphan 'failed' costs one list() and one UPDATE. It must
    // not consume a transcription slot, or a backlog of orphans would starve
    // real work.
    const stale = new Date(NOW - (STALE_AFTER_MS + 1)).toISOString();
    const p = ports({
      listUploading: vi.fn(async () => [
        row({ id: "orphan-1", updated_at: stale }),
        row({ id: "orphan-2", updated_at: stale }),
        row({ id: "orphan-3", updated_at: stale }),
        row({ id: "real" }),
      ]),
      objectExists: vi.fn(async (path: string) => path.endsWith("real")),
    });
    const report = await sweep(p);

    expect(report.failed).toBe(3);
    expect(report.transcribed).toBe(1);
  });

  it("logs what it dropped rather than reporting silent completeness", async () => {
    const many = Array.from({ length: 10 }, (_, i) => row({ id: `note-${i}` }));
    const log = vi.fn();
    await sweep(ports({ listUploading: vi.fn(async () => many), log }));

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/deferred/i));
  });

  it("says nothing about a backlog when every row is simply still uploading", async () => {
    // The report is the ONLY observability surface — there is no error column.
    // Twelve in-flight uploads must not produce a log line blaming a cap that
    // was never reached.
    const young = Array.from({ length: 5 }, (_, i) => row({ id: `note-${i}` }));
    const log = vi.fn();
    const report = await sweep(
      ports({
        listUploading: vi.fn(async () => young),
        objectExists: vi.fn(async () => false),
        log,
      }),
    );

    expect(report.waiting).toBe(5);
    expect(report.deferred).toBe(0);
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/deferred/i));
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

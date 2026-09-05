import { describe, it, expect, vi } from "vitest";
import {
  MAX_NOTEGEN_PER_RUN,
  NOTEGEN_STALE_AFTER_MS,
  notegenSweep,
  type GeneratableRow,
  type NotegenPorts,
} from "@/lib/notegen/sweep";

const NOW = 1_800_000_000_000;

function rowsOf(count: number): GeneratableRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    user_id: "u1",
    raw_transcript: "Dana: we ship mapping first.",
    updated_at: new Date(NOW - 1000).toISOString(),
  }));
}

function ports(overrides: Partial<NotegenPorts> = {}) {
  const base: NotegenPorts = {
    now: () => NOW,
    log: vi.fn(),
    listGeneratable: vi.fn(async () => rowsOf(2)),
    listStaleGenerating: vi.fn(async () => []),
    claimForGeneration: vi.fn(async () => ({ status: "claimed" as const, personaId: null })),
    resolvePersona: vi.fn(async () => ({
      slug: "neutral-analyst",
      name: "Neutral Analyst",
      depth: "dense" as const,
      source: "row" as const,
    })),
    generate: vi.fn(async () => ({
      title: "T",
      summary: "S",
      takeaways: ["t"],
      actionItems: ["a"],
    })),
    store: {
      deleteGeneratedChunks: vi.fn(async () => {}),
      insertChunks: vi.fn(async () => {}),
      setTitleIfUnset: vi.fn(async () => true),
      completeNotegen: vi.fn(async () => true),
      failNotegen: vi.fn(async () => true),
    },
    ...overrides,
  };

  return { ports: base, generate: base.generate as ReturnType<typeof vi.fn> };
}

const FAR = { deadlineAt: NOW + 240_000 };

describe("notegenSweep", () => {
  it("generates every eligible row inside the cap", async () => {
    const { ports: p } = ports();
    expect((await notegenSweep(p, FAR)).generated).toBe(2);
  });

  it("never exceeds MAX_NOTEGEN_PER_RUN model calls", async () => {
    const { ports: p, generate } = ports({
      listGeneratable: vi.fn(async () => rowsOf(MAX_NOTEGEN_PER_RUN + 4)),
    });
    const report = await notegenSweep(p, FAR);
    expect(generate).toHaveBeenCalledTimes(MAX_NOTEGEN_PER_RUN);
    expect(report.generated).toBe(MAX_NOTEGEN_PER_RUN);
    expect(report.deferred).toBe(4);
  });

  it("claims nothing when the shared budget is already spent", async () => {
    // Phase two runs after transcription on the SAME 300 s ceiling. A run
    // where transcription used the clock must generate nothing rather than
    // start work the platform will kill mid-write.
    const { ports: p, generate } = ports();
    const report = await notegenSweep(p, { deadlineAt: NOW - 1 });
    expect(generate).not.toHaveBeenCalled();
    expect(p.claimForGeneration).not.toHaveBeenCalled();
    expect(report.deferred).toBe(2);
  });

  it("flips a stale 'generating' row to failed and counts it", async () => {
    const { ports: p } = ports({
      listGeneratable: vi.fn(async () => []),
      listStaleGenerating: vi.fn(async () => ["old1", "old2"]),
    });
    const report = await notegenSweep(p, FAR);
    expect(report.reconciled).toBe(2);
    expect(p.store.failNotegen).toHaveBeenCalledWith("old1");
    expect(p.store.failNotegen).toHaveBeenCalledWith("old2");
  });

  it("asks for stale rows using a one-hour cutoff on updated_at", async () => {
    const { ports: p } = ports();
    await notegenSweep(p, FAR);
    const [cutoffIso] = (p.listStaleGenerating as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(cutoffIso).toBe(new Date(NOW - NOTEGEN_STALE_AFTER_MS).toISOString());
  });

  it("spends no model call reconciling a stale row", async () => {
    const { ports: p, generate } = ports({
      listGeneratable: vi.fn(async () => []),
      listStaleGenerating: vi.fn(async () => ["old1"]),
    });
    await notegenSweep(p, FAR);
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not count a lost stale flip as reconciled", async () => {
    const { ports: p } = ports({
      listGeneratable: vi.fn(async () => []),
      listStaleGenerating: vi.fn(async () => ["old1"]),
    });
    p.store.failNotegen = vi.fn(async () => false);
    expect((await notegenSweep(p, FAR)).reconciled).toBe(0);
  });

  it("counts a contended row without spending its cap slot", async () => {
    const { ports: p, generate } = ports({
      listGeneratable: vi.fn(async () => rowsOf(MAX_NOTEGEN_PER_RUN + 1)),
      claimForGeneration: vi.fn(async () => ({ status: "lost" as const })),
    });
    const report = await notegenSweep(p, FAR);
    expect(report.contended).toBe(MAX_NOTEGEN_PER_RUN + 1);
    expect(report.deferred).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  });

  it("counts a blank transcript without spending its cap slot", async () => {
    const rows = rowsOf(2).map((r) => ({ ...r, raw_transcript: "  " }));
    const { ports: p, generate } = ports({
      listGeneratable: vi.fn(async () => rows),
    });
    const report = await notegenSweep(p, FAR);
    expect(report.blank).toBe(2);
    expect(generate).not.toHaveBeenCalled();
  });

  it("counts a generation failure", async () => {
    const { ports: p } = ports({
      listGeneratable: vi.fn(async () => rowsOf(1)),
      generate: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    expect((await notegenSweep(p, FAR)).failed).toBe(1);
  });

  it("logs when work was actually deferred, and stays quiet otherwise", async () => {
    const { ports: quiet } = ports();
    await notegenSweep(quiet, FAR);
    expect(quiet.log).not.toHaveBeenCalledWith(
      expect.stringContaining("deferred"),
    );

    const { ports: busy } = ports({
      listGeneratable: vi.fn(async () => rowsOf(MAX_NOTEGEN_PER_RUN + 1)),
    });
    await notegenSweep(busy, FAR);
    expect(busy.log).toHaveBeenCalledWith(expect.stringContaining("deferred"));
  });

  it("asks for more candidates than it can use, so contended rows do not starve a tick", async () => {
    const { ports: p } = ports();
    await notegenSweep(p, FAR);
    expect(p.listGeneratable).toHaveBeenCalledWith(MAX_NOTEGEN_PER_RUN * 4);
  });
});

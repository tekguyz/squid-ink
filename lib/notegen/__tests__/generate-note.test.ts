import { describe, it, expect, vi } from "vitest";
import {
  claimAndGenerate,
  claimNoteForGeneration,
  generateClaimedNote,
} from "@/lib/notegen/generate-note";
import type { GeneratableRow, NotegenPorts } from "@/lib/notegen/sweep";
import { DEFAULT_PERSONA_FALLBACK } from "@/lib/notes/default-persona";

const ROW: GeneratableRow = {
  id: "n1",
  user_id: "u1",
  raw_transcript: "Dana: we ship mapping first. Ravi: agreed.",
  updated_at: new Date().toISOString(),
};

function ports(overrides: Partial<NotegenPorts> = {}) {
  const generate = vi.fn(async () => ({
    title: "T",
    summary: "S",
    takeaways: ["t"],
    actionItems: ["a"],
  }));

  const base: NotegenPorts = {
    now: () => Date.now(),
    log: vi.fn(),
    listGeneratable: vi.fn(async () => []),
    listStaleGenerating: vi.fn(async () => []),
    claimForGeneration: vi.fn(async () => ({ status: "claimed" as const, personaId: null })),
    resolvePersona: vi.fn(async () => ({
      slug: "neutral-analyst",
      name: "Neutral Analyst",
      depth: "dense" as const,
      source: "row" as const,
    })),
    generate,
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

describe("claimNoteForGeneration", () => {
  it("returns 'claimed' when the guarded update matched", async () => {
    const { ports: p } = ports();
    expect(await claimNoteForGeneration(p, ROW)).toEqual({ outcome: "claimed", personaId: null });
  });

  it("returns 'contended' when the guarded update matched nothing", async () => {
    const { ports: p } = ports({ claimForGeneration: vi.fn(async () => ({ status: "lost" as const })) });
    expect(await claimNoteForGeneration(p, ROW)).toEqual({ outcome: "contended" });
  });

  it("spends no model call on a contended claim", async () => {
    // THE cost guarantee. Counted, not read off the code.
    const { ports: p, generate } = ports({
      claimForGeneration: vi.fn(async () => ({ status: "lost" as const })),
    });
    await claimAndGenerate(p, ROW);
    expect(generate).not.toHaveBeenCalled();
  });

  it("fails a claimed row whose transcript is only whitespace", async () => {
    const { ports: p } = ports();
    const outcome = await claimNoteForGeneration(p, {
      ...ROW,
      raw_transcript: "   \n\t ",
    });
    expect(outcome).toEqual({ outcome: "blank" });
    expect(p.store.failNotegen).toHaveBeenCalledWith("n1");
  });

  it("fails a claimed row whose transcript is null", async () => {
    const { ports: p } = ports();
    expect(
      await claimNoteForGeneration(p, { ...ROW, raw_transcript: null }),
    ).toEqual({ outcome: "blank" });
  });

  it("spends no model call on a blank transcript", async () => {
    const { ports: p, generate } = ports();
    await claimAndGenerate(p, { ...ROW, raw_transcript: "" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not fail a row it never claimed", async () => {
    // Losing the race AND having a blank transcript must not write 'failed'
    // over the winner's 'generating'.
    const { ports: p } = ports({ claimForGeneration: vi.fn(async () => ({ status: "lost" as const })) });
    await claimNoteForGeneration(p, { ...ROW, raw_transcript: "" });
    expect(p.store.failNotegen).not.toHaveBeenCalled();
  });
});

describe("generateClaimedNote", () => {
  it("makes exactly one model call for one note", async () => {
    const { ports: p, generate } = ports();
    await generateClaimedNote(p, ROW, null);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("passes the resolved depth through as a thinking level", async () => {
    const { ports: p, generate } = ports({
      resolvePersona: vi.fn(async () => ({
        slug: "investor",
        name: "Investor",
        depth: "exhaustive" as const,
        source: "row" as const,
      })),
    });
    await generateClaimedNote(p, ROW, null);
    expect(generate.mock.calls[0][0].plan.thinkingLevel).toBe("high");
    expect(generate.mock.calls[0][0].lens.slug).toBe("investor");
  });

  it("completes on the fallback persona rather than throwing", async () => {
    // The zero-persona-row path: an account created before the 2026-08-31
    // provisioning trigger. It must generate, not crash.
    const { ports: p, generate } = ports({
      resolvePersona: vi.fn(async () => ({
        slug: DEFAULT_PERSONA_FALLBACK.id,
        name: DEFAULT_PERSONA_FALLBACK.name,
        depth: DEFAULT_PERSONA_FALLBACK.depth,
        source: "fallback" as const,
      })),
    });
    expect(await generateClaimedNote(p, ROW, null)).toBe("generated");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(p.store.completeNotegen).toHaveBeenCalledWith("n1");
  });

  it("marks the row failed when the model throws", async () => {
    const { ports: p } = ports({
      generate: vi.fn(async () => {
        throw new Error("429 rate limited");
      }),
    });
    expect(await generateClaimedNote(p, ROW, null)).toBe("failed");
    expect(p.store.failNotegen).toHaveBeenCalledWith("n1");
  });

  it("puts the failure reason in the log, since there is no error column", async () => {
    const { ports: p } = ports({
      generate: vi.fn(async () => {
        throw new Error("429 rate limited");
      }),
    });
    await generateClaimedNote(p, ROW, null);
    expect(p.log).toHaveBeenCalledWith(
      expect.stringContaining("429 rate limited"),
    );
  });

  it("marks the row failed when the flip loses to the staleness sweep", async () => {
    const { ports: p } = ports();
    p.store.completeNotegen = vi.fn(async () => false);
    expect(await generateClaimedNote(p, ROW, null)).toBe("failed");
  });

  it("marks the row failed when resolving a persona throws", async () => {
    // permission denied for table personas lands here. It must not leave the
    // row stuck at 'generating' for an hour with nothing in the log.
    const { ports: p } = ports({
      resolvePersona: vi.fn(async () => {
        throw new Error("permission denied for table personas");
      }),
    });
    expect(await generateClaimedNote(p, ROW, null)).toBe("failed");
    expect(p.log).toHaveBeenCalledWith(
      expect.stringContaining("permission denied"),
    );
  });

  it("names the resolution path in the log line", async () => {
    const { ports: p } = ports();
    await generateClaimedNote(p, ROW, null);
    expect(p.log).toHaveBeenCalledWith(expect.stringContaining("persona from row"));
  });
});

describe("claimAndGenerate", () => {
  it("returns 'generated' on the happy path", async () => {
    const { ports: p } = ports();
    expect(await claimAndGenerate(p, ROW)).toBe("generated");
  });

  it("short-circuits before resolving a persona when contended", async () => {
    const { ports: p } = ports({ claimForGeneration: vi.fn(async () => ({ status: "lost" as const })) });
    await claimAndGenerate(p, ROW);
    expect(p.resolvePersona).not.toHaveBeenCalled();
  });
});

describe("the claimed persona reaches resolution", () => {
  it("carries persona_id out of the claim", async () => {
    const { ports: p } = ports({
      claimForGeneration: vi.fn(async () => ({
        status: "claimed" as const,
        personaId: "p-uuid",
      })),
    });
    expect(await claimNoteForGeneration(p, ROW)).toEqual({
      outcome: "claimed",
      personaId: "p-uuid",
    });
  });

  it("hands that persona to resolvePersona, with the note's owner", async () => {
    const { ports: p } = ports();
    await generateClaimedNote(p, ROW, "p-uuid");
    expect(p.resolvePersona).toHaveBeenCalledWith(ROW.user_id, "p-uuid");
  });

  it("passes null through unchanged for a note with no persona", async () => {
    // Every note written before 2026-09-02. It must resolve exactly as it did.
    const { ports: p } = ports();
    await generateClaimedNote(p, ROW, null);
    expect(p.resolvePersona).toHaveBeenCalledWith(ROW.user_id, null);
  });

  it("threads the claimed persona end to end through claimAndGenerate", async () => {
    const { ports: p } = ports({
      claimForGeneration: vi.fn(async () => ({
        status: "claimed" as const,
        personaId: "p-uuid",
      })),
    });
    await claimAndGenerate(p, ROW);
    expect(p.resolvePersona).toHaveBeenCalledWith(ROW.user_id, "p-uuid");
  });

  it("still spends no model call on a lost claim", async () => {
    const { ports: p } = ports({
      claimForGeneration: vi.fn(async () => ({ status: "lost" as const })),
    });
    expect(await claimAndGenerate(p, ROW)).toBe("contended");
    expect(p.resolvePersona).not.toHaveBeenCalled();
    expect(p.generate).not.toHaveBeenCalled();
  });
});

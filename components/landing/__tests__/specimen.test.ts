// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  SPECIMEN_ACTIONS,
  SPECIMEN_DURATION,
  SPECIMEN_SEGMENTS,
  SPECIMEN_SUMMARY,
  SPECIMEN_TAKEAWAYS,
  SPECIMEN_TITLE,
} from "../specimen";
import { LANDING_PERSONAS } from "../persona-table";

/** The landing page claims to show the real product. These tests hold it to
 *  that: every word it quotes is in the demo fixture, and every persona it
 *  lists is one a new account really gets. */
interface Chunk {
  chunkType: string;
  content: string;
  metadata: {
    n?: string;
    seq: number;
    ts_start?: string;
    speaker?: { name: string; token: string };
  };
}
const fixture = JSON.parse(readFileSync("lib/demo/demo-note-2.json", "utf8")) as {
  note: { title: string; audioDurationSeconds: number };
  chunks: Chunk[];
};
const chunks = (type: string) => fixture.chunks.filter((c) => c.chunkType === type);

describe("the landing specimen", () => {
  it("quotes the demo note's title, length and summary", () => {
    expect(SPECIMEN_TITLE).toBe(fixture.note.title);
    const s = fixture.note.audioDurationSeconds;
    expect(SPECIMEN_DURATION).toBe(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
    expect(chunks("summary")[0].content.startsWith(SPECIMEN_SUMMARY)).toBe(true);
  });

  it.each([
    ["takeaway", SPECIMEN_TAKEAWAYS],
    ["action_item", SPECIMEN_ACTIONS],
  ] as const)("quotes each %s verbatim, under its own number", (type, claims) => {
    for (const claim of claims) {
      const chunk = chunks(type).find((c) => c.metadata.n === claim.n);
      expect(chunk?.content).toBe(claim.text);
    }
  });

  it("quotes each transcript line with its real time and speaker", () => {
    for (const seg of SPECIMEN_SEGMENTS) {
      const chunk = chunks("transcript_segment").find((c) => c.metadata.seq === seg.id);
      expect(chunk?.content).toBe(seg.text);
      expect(chunk?.metadata.ts_start).toBe(seg.time);
      expect(chunk?.metadata.speaker).toMatchObject({ name: seg.speaker.name, token: seg.speaker.token });
    }
  });

  it("cites one line per claim, as the pipeline does, and only lines it shows", () => {
    const shown = new Set(SPECIMEN_SEGMENTS.map((s) => s.id));
    for (const claim of [...SPECIMEN_TAKEAWAYS, ...SPECIMEN_ACTIONS]) {
      expect(claim.cites.length).toBeLessThanOrEqual(1);
      for (const id of claim.cites) expect(shown.has(id)).toBe(true);
    }
  });
});

describe("the landing persona table", () => {
  const sql = readFileSync("supabase/schemas/persona_provisioning.sql", "utf8");

  it("lists exactly the default personas a new account is given", () => {
    for (const p of LANDING_PERSONAS) expect(sql).toContain(`'${p.name}', '${p.sub}'`);
    expect(sql.match(/\(new\.id, '/g)).toHaveLength(LANDING_PERSONAS.length);
  });
});

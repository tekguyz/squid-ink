import { describe, it, expect } from "vitest";
import {
  GEMINI_NOTEGEN_MODEL,
  parseGeneratedNote,
  responseSchemaFor,
  systemPromptFor,
} from "@/lib/notegen/gemini-client";
import { planForDepth } from "@/lib/notegen/depth-policy";
import { lensPromptFor } from "@/lib/notegen/lens-prompts";

describe("GEMINI_NOTEGEN_MODEL", () => {
  it("is the flash id verified against the live models endpoint", () => {
    expect(GEMINI_NOTEGEN_MODEL).toBe("gemini-3.7-flash");
  });
});

describe("systemPromptFor", () => {
  it("carries the lens framing verbatim", () => {
    const lens = lensPromptFor("investor");
    expect(systemPromptFor(lens, planForDepth("dense"))).toContain(lens.framing);
  });

  it("names the lens so the model is given a role", () => {
    const lens = lensPromptFor("sales-coach");
    expect(systemPromptFor(lens, planForDepth("dense"))).toContain(lens.label);
  });

  it("asks brief for no summary and exhaustive for cross-referencing", () => {
    const lens = lensPromptFor("neutral-analyst");
    const brief = systemPromptFor(lens, planForDepth("brief"));
    const exhaustive = systemPromptFor(lens, planForDepth("exhaustive"));

    expect(brief).toMatch(/no summary/i);
    expect(exhaustive).toMatch(/cross-referenc/i);
    expect(brief).not.toEqual(exhaustive);
  });

  it("differs across all three depths for one lens", () => {
    const lens = lensPromptFor("neutral-analyst");
    const prompts = (["brief", "dense", "exhaustive"] as const).map((d) =>
      systemPromptFor(lens, planForDepth(d)),
    );
    expect(new Set(prompts).size).toBe(3);
  });

  it("differs across lenses at one depth", () => {
    const dense = planForDepth("dense");
    const prompts = ["neutral-analyst", "sales-coach", "investor"].map((s) =>
      systemPromptFor(lensPromptFor(s), dense),
    );
    expect(new Set(prompts).size).toBe(3);
  });
});

describe("responseSchemaFor", () => {
  it("omits summary entirely when the depth wants none", () => {
    const schema = responseSchemaFor(planForDepth("brief"));
    // title survives the omission — it is the note's name, not part of its
    // body, and a brief note still has to be nameable in a citation chip.
    expect(Object.keys(schema.properties as object)).toEqual([
      "title",
      "takeaways",
      "action_items",
    ]);
  });

  it("requires all four when the depth wants a summary", () => {
    const schema = responseSchemaFor(planForDepth("dense"));
    expect(schema.required).toEqual([
      "title",
      "summary",
      "takeaways",
      "action_items",
    ]);
  });

  it("types both lists as arrays of strings", () => {
    const schema = responseSchemaFor(planForDepth("dense")) as {
      properties: Record<string, unknown>;
    };
    expect(schema.properties.takeaways).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });
});

describe("parseGeneratedNote", () => {
  it("reads the three fields off well-formed JSON", () => {
    expect(
      parseGeneratedNote(
        '{"summary":"S","takeaways":["a","b"],"action_items":["c"]}',
      ),
    ).toEqual({ title: null, summary: "S", takeaways: ["a", "b"], actionItems: ["c"] });
  });

  it("returns a null summary when the field is absent", () => {
    expect(
      parseGeneratedNote('{"takeaways":[],"action_items":[]}').summary,
    ).toBeNull();
  });

  it("tolerates a fenced code block around the JSON", () => {
    // response_format should prevent this, but a model that ignores it once
    // must not cost the whole call. Cheap to tolerate, expensive to be
    // surprised by in production.
    const fenced =
      '```json\n{"summary":"S","takeaways":[],"action_items":[]}\n```';
    expect(parseGeneratedNote(fenced).summary).toBe("S");
  });

  it("throws with the offending text when the body is not JSON", () => {
    expect(() => parseGeneratedNote("I'm afraid I can't do that")).toThrow(
      /did not return JSON/i,
    );
  });

  it("coerces a non-array takeaways field to an empty array", () => {
    expect(
      parseGeneratedNote('{"summary":"S","takeaways":"oops","action_items":[]}')
        .takeaways,
    ).toEqual([]);
  });

  it("drops non-string entries rather than writing them as chunks", () => {
    expect(
      parseGeneratedNote('{"takeaways":["a",5,null,"b"],"action_items":[]}')
        .takeaways,
    ).toEqual(["a", "b"]);
  });

  it("survives a JSON null body without throwing on property access", () => {
    expect(parseGeneratedNote("null")).toEqual({
      title: null,
      summary: null,
      takeaways: [],
      actionItems: [],
    });
  });
});

describe("title in the structured output", () => {
  it("asks for a title at every depth, including Brief", () => {
    // A brief note still has to be distinguishable in a citation chip, so the
    // summary/no-summary split does not reach the title.
    for (const depth of ["brief", "dense"] as const) {
      const schema = responseSchemaFor(planForDepth(depth)) as {
        properties: Record<string, unknown>;
        required: string[];
      };
      expect(schema.properties.title).toEqual({ type: "string" });
      expect(schema.required).toContain("title");
    }
  });

  it("parses and normalises the title out of the same response", () => {
    // ONE call. The title is a field on the structured note, never a second
    // model call.
    expect(
      parseGeneratedNote(
        JSON.stringify({
          title: "  Mapping   before billing ",
          summary: "S",
          takeaways: [],
          action_items: [],
        }),
      ).title,
    ).toBe("Mapping before billing");
  });

  it("returns a null title when the model omitted or blanked it", () => {
    expect(parseGeneratedNote(JSON.stringify({ takeaways: [] })).title).toBe(null);
    expect(parseGeneratedNote(JSON.stringify({ title: "  " })).title).toBe(null);
    expect(parseGeneratedNote(JSON.stringify({ title: 7 })).title).toBe(null);
  });
});

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
    expect(Object.keys(schema.properties as object)).toEqual([
      "takeaways",
      "action_items",
    ]);
  });

  it("requires all three when the depth wants a summary", () => {
    const schema = responseSchemaFor(planForDepth("dense"));
    expect(schema.required).toEqual(["summary", "takeaways", "action_items"]);
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
    ).toEqual({ summary: "S", takeaways: ["a", "b"], actionItems: ["c"] });
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
      summary: null,
      takeaways: [],
      actionItems: [],
    });
  });
});

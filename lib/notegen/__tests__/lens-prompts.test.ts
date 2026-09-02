import { describe, it, expect } from "vitest";
import { lensPromptFor } from "@/lib/notegen/lens-prompts";
import { DEFAULT_PERSONA_ID } from "@/lib/notes/default-persona";

describe("lensPromptFor", () => {
  it("has a distinct framing for each of the four locked lenses", () => {
    const slugs = [
      "neutral-analyst",
      "sales-coach",
      "investor",
      "engineering-lead",
    ];
    const framings = slugs.map((s) => lensPromptFor(s).framing);

    for (const framing of framings) expect(framing.length).toBeGreaterThan(0);
    expect(new Set(framings).size).toBe(4);
  });

  it("keys on slug, which is what the database uniquely constrains", () => {
    expect(lensPromptFor("sales-coach").slug).toBe("sales-coach");
  });

  it("falls back to the neutral lens for an unrecognised slug", () => {
    // Custom personas are a documented later phase. One arriving early must
    // not throw inside a cron run.
    expect(lensPromptFor("chief-vibes-officer")).toEqual(
      lensPromptFor(DEFAULT_PERSONA_ID),
    );
  });

  it("falls back for an empty slug rather than returning undefined", () => {
    expect(lensPromptFor("").framing).toBe(
      lensPromptFor(DEFAULT_PERSONA_ID).framing,
    );
  });

  it("is keyed by the same slugs persona_provisioning.sql inserts", () => {
    // If provisioning ever renames a slug, this catches the drift here rather
    // than as silently neutral output for three of the four lenses.
    for (const slug of [
      "neutral-analyst",
      "sales-coach",
      "investor",
      "engineering-lead",
    ]) {
      expect(lensPromptFor(slug).slug).toBe(slug);
    }
  });

  it("uses DEFAULT_PERSONA_ID as the neutral key, not a second literal", () => {
    // DEFAULT_PERSONA_ID is the slug "neutral-analyst". A second hardcoded
    // copy here would be a place for the two to drift apart.
    expect(lensPromptFor(DEFAULT_PERSONA_ID).slug).toBe(DEFAULT_PERSONA_ID);
  });
});

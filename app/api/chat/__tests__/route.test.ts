import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Read as source text on purpose. Every assertion below is about what the
 *  route does NOT do, and a negative is far easier to prove against the file
 *  than against a mocked streaming run. Same blunt-but-decisive style as
 *  components/note-detail/__tests__/project-conventions.test.ts.
 *
 *  COMMENTS AND IMPORTS ARE STRIPPED FIRST, and that is not cosmetic. A raw
 *  grep for "sendReasoning" matches the comment that explains why it is not
 *  set, and a raw indexOf("streamText") finds the IMPORT at the top of the
 *  file rather than the call — which made the ordering assertion compare an
 *  import against a call site and fail a correct route. Assert against the
 *  code that runs. */
const RAW = readFileSync(
  path.resolve(import.meta.dirname, "../route.ts"),
  "utf8",
);

const SOURCE = (() => {
  const stripped = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /^\s*\/\/.*$/gm,
    "",
  );
  const bodyStart = stripped.indexOf("export const maxDuration");
  if (bodyStart === -1) throw new Error("route.ts has no maxDuration export");
  return stripped.slice(bodyStart);
})();

describe("app/api/chat/route.ts invariants", () => {
  it("turns reasoning forwarding OFF explicitly", () => {
    // CORRECTED 2026-09-03. This asserted the OPPOSITE — that the source
    // never mentions sendReasoning — on the belief that the flag is
    // opt-in. It is not: ai 7.0.92 defaults it to TRUE
    // (node_modules/ai/dist/index.js:7932). Omitting it opted IN, and this
    // test locked that in by forbidding the fix.
    expect(SOURCE).toMatch(/sendReasoning:\s*false/);
  });

  it("consumes the stream independently of the response", () => {
    // onFinish fires when the stream ends. If the HTTP response is its
    // only reader, closing the tab mid-answer cancels it, the callback
    // never runs, and the thread ends on a user turn with no reply.
    expect(SOURCE).toMatch(/consumeStream\(\)/);
  });

  it("wraps the handler so a port error returns JSON, not HTML", () => {
    // Every port throws on a Postgres error, and the client parses JSON.
    expect(SOURCE).toMatch(/catch \(error\)/);
  });

  it("puts the cached transcript block AHEAD of history", () => {
    // Anthropic caching is a prefix match. With the block after history,
    // turn 2 diverges from turn 1's prefix right after `system` and the
    // cache never reads — which would falsify the whole single-note cost
    // claim while every other test still passed.
    const blockAt = SOURCE.indexOf("buildTranscriptBlock(noteContext)");
    const spreadAt = SOURCE.indexOf("...flat,");
    expect(blockAt).toBeGreaterThan(-1);
    expect(spreadAt).toBeGreaterThan(-1);
    expect(blockAt).toBeLessThan(spreadAt);
  });

  it("passes a stop condition so the tool loop can finish", () => {
    // CORRECTED 2026-09-03. The old name of this test claimed stepCountIs
    // does not exist in ai 7.x. It does — index.d.ts exports
    // `isStepCount as stepCountIs`, so the two are the same function. What
    // actually matters is that SOME stop condition is passed: without one
    // the run halts after the tool call and never writes an answer.
    expect(SOURCE).toMatch(/stopWhen:\s*(isStepCount|stepCountIs)\(/);
  });

  it("never sends budget_tokens — Sonnet 5 answers 400", () => {
    expect(SOURCE).not.toMatch(/budget_tokens/);
  });

  it("pins the model id exactly, with no date suffix", () => {
    expect(SOURCE).toMatch(/"claude-sonnet-5"/);
    expect(SOURCE).not.toMatch(/claude-sonnet-5-\d/);
  });

  it("sets the ephemeral cache breakpoint on the transcript block", () => {
    expect(SOURCE).toMatch(/cacheControl:\s*\{\s*type:\s*"ephemeral"\s*\}/);
  });

  it("does not filter any query on user_id", () => {
    // RLS supplies it. A redundant filter masks an RLS failure. The route may
    // still READ the id to write it onto a row it owns, which is why this
    // looks for the filter shape rather than the string.
    expect(SOURCE).not.toMatch(/\.eq\(\s*["']user_id["']/);
  });

  it("checks length and rate BEFORE streaming", () => {
    const lengthAt = SOURCE.indexOf("overLengthCap");
    const rateAt = SOURCE.indexOf("countRecentUserMessages");
    const streamAt = SOURCE.indexOf("streamText");

    expect(lengthAt).toBeGreaterThan(-1);
    expect(rateAt).toBeGreaterThan(-1);
    expect(streamAt).toBeGreaterThan(-1);
    expect(lengthAt).toBeLessThan(streamAt);
    expect(rateAt).toBeLessThan(streamAt);
  });

  it("checks length before it checks the rate limit", () => {
    // Cheapest first: the length cap is a string compare, the rate limit is a
    // round trip to Postgres.
    expect(SOURCE.indexOf("overLengthCap")).toBeLessThan(
      SOURCE.indexOf("countRecentUserMessages"),
    );
  });

  it("reads history from the database, not from the request body", () => {
    // The client posts its whole message array. Trusting it would let a
    // forged 500-turn history walk past trimHistory — one of the two cost
    // ceilings this feature exists to hold.
    expect(SOURCE).toMatch(/readHistory/);
    expect(SOURCE).toMatch(/trimHistory/);
    expect(SOURCE).not.toMatch(/body\??\.messages/);
  });

  it("is the only shipped reader of ANTHROPIC_API_KEY, and reads it server-side", () => {
    expect(SOURCE).toMatch(/process\.env\.ANTHROPIC_API_KEY/);
    expect(SOURCE).not.toMatch(/NEXT_PUBLIC_ANTHROPIC/);
  });

  it("sends the workspace id only when one is configured", () => {
    // An identity-linked key is scoped to a person, not a workspace, and the
    // API answers 400 without this header. A plain workspace-scoped key must
    // NOT send it, so it is conditional rather than always-on. Measured
    // against the live API on 2026-09-03.
    expect(SOURCE).toMatch(/process\.env\.ANTHROPIC_WORKSPACE_ID/);
    expect(SOURCE).toMatch(/"anthropic-workspace-id"/);
    // Conditional, not unconditional: the header is spread in behind a check.
    expect(SOURCE).toMatch(/\.\.\.\(workspaceId/);
  });

  it("caps its own duration well under the Hobby ceiling", () => {
    // 300 s is both the default and the hard maximum on Hobby. A chat turn is
    // seconds; leaving it at the ceiling would let one hung request hold a
    // function slot for five minutes.
    const match = SOURCE.match(/export const maxDuration = (\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeLessThanOrEqual(300);
  });
});

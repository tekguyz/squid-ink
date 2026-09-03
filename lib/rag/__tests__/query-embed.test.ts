import { describe, it, expect, vi, afterEach } from "vitest";
import { createVoyageQueryEmbedder } from "@/lib/rag/query-embed";
import { VoyageError, VOYAGE_OUTPUT_DIMENSION } from "@/lib/rag/voyage-client";

const vector = () => Array.from({ length: VOYAGE_OUTPUT_DIMENSION }, () => 0.1);

function mockFetch(body: unknown, status = 200) {
  const spy = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => vi.unstubAllGlobals());

describe("createVoyageQueryEmbedder", () => {
  it("sends input_type 'query' — NOT 'document'", async () => {
    // Voyage is asymmetric. This is the whole reason the file exists: sending
    // "document" for a question degrades ranking with no error at all.
    const spy = mockFetch({ data: [{ index: 0, embedding: vector() }] });
    await createVoyageQueryEmbedder("k")("what did we decide about pricing?");

    const sent = JSON.parse(
      (spy.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(sent.input_type).toBe("query");
    expect(sent.input_type).not.toBe("document");
  });

  it("pins the output dimension and dtype the column requires", async () => {
    const spy = mockFetch({ data: [{ index: 0, embedding: vector() }] });
    await createVoyageQueryEmbedder("k")("q");

    const sent = JSON.parse(
      (spy.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(sent.output_dimension).toBe(1024);
    expect(sent.output_dtype).toBe("float");
  });

  it("sends exactly one text, never an array of many", async () => {
    const spy = mockFetch({ data: [{ index: 0, embedding: vector() }] });
    await createVoyageQueryEmbedder("k")("q");

    const sent = JSON.parse(
      (spy.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(sent.input).toEqual(["q"]);
  });

  it("returns the bare vector, not a one-element array of vectors", async () => {
    mockFetch({ data: [{ index: 0, embedding: vector() }] });
    const got = await createVoyageQueryEmbedder("k")("q");

    expect(Array.isArray(got)).toBe(true);
    expect(got).toHaveLength(VOYAGE_OUTPUT_DIMENSION);
    expect(typeof got[0]).toBe("number");
  });

  it("refuses a vector of the wrong width", async () => {
    mockFetch({ data: [{ index: 0, embedding: [0.1, 0.2] }] });
    await expect(createVoyageQueryEmbedder("k")("q")).rejects.toBeInstanceOf(
      VoyageError,
    );
  });

  it("classifies 429 as transient and 400 as content", async () => {
    mockFetch({ error: "slow down" }, 429);
    await expect(createVoyageQueryEmbedder("k")("q")).rejects.toMatchObject({
      kind: "transient",
    });

    mockFetch({ error: "bad" }, 400);
    await expect(createVoyageQueryEmbedder("k")("q")).rejects.toMatchObject({
      kind: "content",
    });
  });

  it("classifies 401 as fatal — a deployment problem, not a query problem", async () => {
    mockFetch({ error: "nope" }, 401);
    await expect(createVoyageQueryEmbedder("k")("q")).rejects.toMatchObject({
      kind: "fatal",
    });
  });

  it("refuses blank input without spending a call", async () => {
    const spy = mockFetch({ data: [] });
    await expect(createVoyageQueryEmbedder("k")("   ")).rejects.toBeInstanceOf(
      VoyageError,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

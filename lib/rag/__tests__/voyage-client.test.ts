import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createVoyageEmbedder,
  estimateTokens,
  VoyageError,
  VOYAGE_MAX_BATCH_TEXTS,
  VOYAGE_MAX_BATCH_TOKENS,
  VOYAGE_MODEL,
  VOYAGE_OUTPUT_DIMENSION,
} from "@/lib/rag/voyage-client";

const vector = (fill: number) => Array.from({ length: 1024 }, () => fill);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createVoyageEmbedder", () => {
  it("posts the pinned request shape to the documented endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        object: "list",
        data: [{ object: "embedding", embedding: vector(0.1), index: 0 }],
        model: VOYAGE_MODEL,
        usage: { total_tokens: 5 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createVoyageEmbedder("vk-test")(["hello"]);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer vk-test",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      input: ["hello"],
      model: "voyage-4",
      input_type: "document",
      output_dimension: 1024,
      output_dtype: "float",
      truncation: true,
    });
  });

  it("returns vectors ordered by the response index, not by arrival", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({
        object: "list",
        data: [
          { object: "embedding", embedding: vector(0.2), index: 1 },
          { object: "embedding", embedding: vector(0.1), index: 0 },
        ],
        model: VOYAGE_MODEL,
        usage: { total_tokens: 9 },
      }),
    );

    const out = await createVoyageEmbedder("vk-test")(["a", "b"]);
    expect(out[0][0]).toBe(0.1);
    expect(out[1][0]).toBe(0.2);
  });

  it("rejects a vector of the wrong width — the column is fixed at 1024", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({
        object: "list",
        data: [{ object: "embedding", embedding: [1, 2, 3], index: 0 }],
        model: VOYAGE_MODEL,
        usage: { total_tokens: 1 },
      }),
    );

    await expect(createVoyageEmbedder("k")(["a"])).rejects.toThrow(/1024/);
  });

  it("rejects a short response rather than mis-pairing vectors to chunks", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({
        object: "list",
        data: [{ object: "embedding", embedding: vector(0.1), index: 0 }],
        model: VOYAGE_MODEL,
        usage: { total_tokens: 1 },
      }),
    );

    await expect(createVoyageEmbedder("k")(["a", "b"])).rejects.toThrow(
      /2 text/,
    );
  });

  it("refuses more than the documented 1,000-item input cap before sending", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const texts = Array.from({ length: 1001 }, () => "x");
    await expect(createVoyageEmbedder("k")(texts)).rejects.toThrow(/1000/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies 401 as fatal — a bad key must not burn every chunk's attempts", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ detail: "no" }, 401));
    const error = await createVoyageEmbedder("k")(["a"]).catch((e) => e);
    expect(error).toBeInstanceOf(VoyageError);
    expect(error.kind).toBe("fatal");
    expect(error.status).toBe(401);
  });

  it("classifies 429 and 503 as transient", async () => {
    for (const status of [429, 503]) {
      vi.stubGlobal("fetch", async () =>
        jsonResponse({ detail: "later" }, status),
      );
      const error = await createVoyageEmbedder("k")(["a"]).catch((e) => e);
      expect(error.kind).toBe("transient");
    }
  });

  it("classifies 400 as content — evidence about this text", async () => {
    vi.stubGlobal("fetch", async () => jsonResponse({ detail: "bad" }, 400));
    const error = await createVoyageEmbedder("k")(["a"]).catch((e) => e);
    expect(error.kind).toBe("content");
  });

  it("classifies a network throw as transient", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const error = await createVoyageEmbedder("k")(["a"]).catch((e) => e);
    expect(error).toBeInstanceOf(VoyageError);
    expect(error.kind).toBe("transient");
    expect(error.status).toBeNull();
  });

  it("returns an empty array without calling the API for no input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await createVoyageEmbedder("k")([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("batch sizing constants", () => {
  it("stays well under the documented per-request caps", () => {
    expect(VOYAGE_MAX_BATCH_TEXTS).toBeLessThanOrEqual(1000);
    expect(VOYAGE_MAX_BATCH_TOKENS).toBeLessThanOrEqual(320_000);
    expect(VOYAGE_OUTPUT_DIMENSION).toBe(1024);
  });

  it("names the current-generation model, not the legacy tier", () => {
    // voyage-3-large is Voyage's legacy tier: $0.18/M with no free allowance.
    // voyage-4 is $0.06/M with 200M free tokens, and is dimension- and
    // dtype-identical. Swapped 2026-09-03; see docs/DECISIONS.md § RAG.
    expect(VOYAGE_MODEL).toBe("voyage-4");
  });

  it("estimates tokens conservatively — never under four characters each", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

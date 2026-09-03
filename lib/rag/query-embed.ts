/** The QUERY side of Voyage's asymmetric embedding, and the only reason this
 *  file is separate from voyage-client.ts.
 *
 *  Voyage embeds stored content and search questions differently. Stored
 *  content is a "document"; the question asked at retrieval time is a
 *  "query". Sending the wrong one does NOT error — it silently returns a
 *  vector that ranks worse. A boolean parameter on the document embedder
 *  would put both behaviours one typo apart in the same call site, so they
 *  live in separate functions with separate tests instead.
 *
 *  Reads no environment variable, exactly like every other module under
 *  lib/rag/. The caller supplies the key, which is what keeps VOYAGE_API_KEY
 *  out of every client component's import graph. project-conventions.test.ts
 *  fails the build if that stops being true.
 *
 *  The pins are imported rather than restated: the endpoint, the model and
 *  the 1024 width are stated once, in voyage-client.ts, next to the reasons
 *  they were chosen.
 *
 *  Plain fields on the errors it throws, never constructor parameter
 *  properties — scripts/verify-chat-search.mjs loads this module through
 *  Node's strip-only type stripping, which rejects `readonly kind:` in a
 *  parameter list. VoyageError already honours that; keep this file loadable
 *  the same way.
 */

import {
  VOYAGE_ENDPOINT,
  VOYAGE_MODEL,
  VOYAGE_OUTPUT_DIMENSION,
  VoyageError,
  type VoyageErrorKind,
} from "./voyage-client";

/** One question in, one vector out. */
export type QueryEmbedder = (text: string) => Promise<number[]>;

function kindFor(status: number): VoyageErrorKind {
  if (status === 401 || status === 403) return "fatal";
  if (status === 429 || status >= 500) return "transient";
  return "content";
}

interface VoyageResponse {
  data?: { embedding?: unknown; index?: unknown }[];
}

export function createVoyageQueryEmbedder(apiKey: string): QueryEmbedder {
  return async (text) => {
    // Blank in, blank out — and no call, because a whitespace question is a
    // client bug rather than something Voyage can answer.
    if (text.trim().length === 0) {
      throw new VoyageError("refusing to embed a blank query", "content", null);
    }

    let response: Response;
    try {
      response = await fetch(VOYAGE_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: [text],
          model: VOYAGE_MODEL,
          // THE reason this file exists. Never "document".
          input_type: "query",
          output_dimension: VOYAGE_OUTPUT_DIMENSION,
          output_dtype: "float",
          truncation: true,
        }),
      });
    } catch (error) {
      // DNS, TLS, socket. Nothing about the text, so nothing to charge it for.
      const reason = error instanceof Error ? error.message : String(error);
      throw new VoyageError(
        `voyage query request failed: ${reason}`,
        "transient",
        null,
      );
    }

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 300);
      throw new VoyageError(
        `voyage returned ${response.status}: ${body}`,
        kindFor(response.status),
        response.status,
      );
    }

    const payload = (await response.json()) as VoyageResponse;
    const embedding = payload.data?.[0]?.embedding;

    if (
      !Array.isArray(embedding) ||
      embedding.length !== VOYAGE_OUTPUT_DIMENSION
    ) {
      throw new VoyageError(
        `voyage returned a ${
          Array.isArray(embedding) ? embedding.length : "non-array"
        } query vector; note_chunks.embedding is a fixed ` +
          `vector(${VOYAGE_OUTPUT_DIMENSION})`,
        "content",
        response.status,
      );
    }

    return embedding as number[];
  };
}

/** The search_notes tool: the ONLY retrieval consumer in this app.
 *
 *  It exists only in all-notes mode, which is why it takes no scope
 *  parameter — a parameter would be a second way to say something the tool's
 *  presence already says.
 *
 *  Reads no environment variable, like every module under lib/rag/. The
 *  caller supplies the embedder and the RPC, which is what keeps
 *  VOYAGE_API_KEY out of every client component's import graph.
 */

import { tool } from "ai";
import { z } from "zod";
import type { QueryEmbedder } from "@/lib/rag/query-embed";
import type { SearchHit } from "@/lib/chat/types";

/** The second cap. search_note_chunks already limits to 25; this holds even
 *  if that function is edited, because "all notes" must never be able to fill
 *  a context window. */
export const MAX_SEARCH_RESULTS = 25;

export interface SearchPorts {
  embedQuery: QueryEmbedder;
  /** Runs search_note_chunks. `vector` is already a pgvector text literal. */
  rpc: (vector: string, text: string) => Promise<unknown[]>;
}

interface SearchRow {
  chunk_id: string;
  note_id: string;
  note_title: string | null;
  chunk_type: string;
  content: string;
  ts_start: string | null;
  seq: number | null;
  score: number;
}

export async function searchNotes(
  query: string,
  ports: SearchPorts,
): Promise<SearchHit[]> {
  const vector = await ports.embedQuery(query);

  // pgvector's own text input format. A raw array would serialise as a JSON
  // array, which PostgREST hands over as a different type entirely.
  const rows = (await ports.rpc(JSON.stringify(vector), query)) as SearchRow[];

  return rows.slice(0, MAX_SEARCH_RESULTS).map((r) => ({
    chunkId: r.chunk_id,
    noteId: r.note_id,
    noteTitle: r.note_title,
    chunkType: r.chunk_type,
    content: r.content,
    tsStart: r.ts_start,
    seq: r.seq,
    score: r.score,
  }));
}

/** The AI SDK tool. Register it under the key `searchNotes`, which is what
 *  makes the client-side part type `tool-searchNotes`. */
export function createSearchTool(ports: SearchPorts) {
  return tool({
    description:
      "Search the user's own notes for passages relevant to a question. " +
      "Returns numbered results; cite one by writing [[cite:cN]] where N is " +
      "the result number. Returns an empty list when nothing matches, which " +
      "means the notes genuinely do not cover it.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("A natural-language search query, in the user's own words."),
    }),
    execute: async ({ query }) => {
      const hits = await searchNotes(query, ports);
      return {
        resultCount: hits.length,
        results: hits.map((hit, i) => ({
          n: i + 1,
          citeKey: `c${i + 1}`,
          noteTitle: hit.noteTitle ?? "Untitled note",
          chunkType: hit.chunkType,
          tsStart: hit.tsStart,
          content: hit.content,
          // Carried so onFinish can build the persisted citation map without
          // a second lookup.
          chunkId: hit.chunkId,
          noteId: hit.noteId,
        })),
      };
    },
  });
}

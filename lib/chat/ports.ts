/** The one Supabase implementation of everything chat reads and writes.
 *
 *  Kept out of the route for the same reason lib/transcription/
 *  supabase-ports.ts is: the route should read as a sequence of gates, and
 *  the queries should be testable and greppable in one place.
 *
 *  NO QUERY HERE FILTERS ON user_id. RLS supplies it. A redundant filter
 *  would mask an RLS failure instead of exposing it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatScope, ChatTurn, Citation } from "@/lib/chat/types";
import { RATE_WINDOW_MS } from "@/lib/chat/limits";
import type { NoteContext } from "@/lib/chat/context";

interface ChatRow {
  id: string;
  role: string;
  content: string;
  scope: string | null;
  metadata: { citations?: Citation[] } | null;
  created_at: string;
}

interface ChunkRow {
  chunk_type: string;
  content: string;
  metadata: {
    seq?: number;
    ts_start?: string;
    speaker?: { name?: string };
  } | null;
}

export function createChatPorts(supabase: SupabaseClient) {
  return {
    /** Full history for display and for the model. Oldest first. */
    async readHistory(noteId: string): Promise<ChatTurn[]> {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, role, content, scope, metadata, created_at")
        .eq("note_id", noteId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      return ((data ?? []) as ChatRow[]).map((row) => ({
        id: row.id,
        role: row.role as "user" | "assistant",
        content: row.content,
        scope: (row.scope as ChatScope | null) ?? null,
        citations: row.metadata?.citations ?? [],
        createdAt: row.created_at,
      }));
    },

    /** The rate limit. RLS scopes it to the caller — no user_id filter. */
    async countRecentUserMessages(): Promise<number> {
      const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
      const { count, error } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("role", "user")
        .gt("created_at", since);
      if (error) throw error;
      return count ?? 0;
    },

    async insertUserMessage(
      noteId: string,
      ownerId: string,
      content: string,
      scope: ChatScope,
    ): Promise<void> {
      const { error } = await supabase.from("chat_messages").insert({
        note_id: noteId,
        user_id: ownerId,
        role: "user",
        content,
        scope,
      });
      if (error) throw error;
    },

    async insertAssistantMessage(
      noteId: string,
      ownerId: string,
      content: string,
      scope: ChatScope,
      citations: Citation[],
    ): Promise<void> {
      const { error } = await supabase.from("chat_messages").insert({
        note_id: noteId,
        user_id: ownerId,
        role: "assistant",
        content,
        scope,
        metadata: { citations },
      });
      if (error) throw error;
    },

    /** The single-note context. Reads the transcript and the generated
     *  chunks; deliberately does NOT read notegen_status. */
    async readNoteContext(noteId: string): Promise<NoteContext | null> {
      // Issued together, not in sequence. The chunks do not depend on the
      // note row, so awaiting one before starting the other adds a whole
      // round trip to every single-note question for nothing.
      const [
        { data: note, error: noteError },
        { data: chunks, error: chunkError },
      ] = await Promise.all([
        supabase
          .from("notes")
          .select("raw_transcript")
          .eq("id", noteId)
          .maybeSingle(),
        supabase
          .from("note_chunks")
          .select("chunk_type, content, metadata")
          .eq("note_id", noteId),
      ]);
      if (noteError) throw noteError;
      if (chunkError) throw chunkError;
      // Checked after both settle: a missing note means the chunk query was
      // wasted, but RLS makes that the rare case rather than the common one.
      if (!note) return null;

      const rows = (chunks ?? []) as ChunkRow[];
      const ofType = (t: string) =>
        rows.filter((r) => r.chunk_type === t).map((r) => r.content);

      const segments = rows
        .filter((r) => r.chunk_type === "transcript_segment")
        .map((r) => ({
          seq: r.metadata?.seq ?? 0,
          time: r.metadata?.ts_start ?? "00:00",
          speaker: r.metadata?.speaker?.name ?? "Unknown",
          text: r.content,
        }))
        .sort((a, b) => a.seq - b.seq);

      return {
        rawTranscript: (note.raw_transcript as string | null) ?? null,
        segments,
        summary: ofType("summary"),
        takeaways: ofType("takeaway"),
        actionItems: ofType("action_item"),
      };
    },

    async searchRpc(vector: string, text: string): Promise<unknown[]> {
      const { data, error } = await supabase.rpc("search_note_chunks", {
        query_embedding: vector,
        query_text: text,
      });
      if (error) throw error;
      return (data ?? []) as unknown[];
    },
  };
}

export type ChatPorts = ReturnType<typeof createChatPorts>;

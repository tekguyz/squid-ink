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

    /** Whether the caller owns this note. RLS answers it — no user_id filter.
     *
     *  Exists for the all_notes path, which has no other reason to read the
     *  note row and therefore had no ownership check at all until 2026-09-15.
     *  A foreign key is validated as the REFERENCED table's owner and is not
     *  subject to RLS, so `note_id references notes (id)` happily accepted a
     *  note belonging to somebody else: the insert landed under the caller's
     *  own user_id and the model call then ran. The answer was useless — the
     *  search is RLS-scoped, so it found only the caller's own chunks — but it
     *  was not free, and "costs money, returns nothing" is the shape of a bill
     *  nobody notices.
     *
     *  Low risk while signup was closed and the app had two accounts. Enabling
     *  anonymous sign-ins for demo mode is what made it reachable by anyone
     *  holding the publishable key, which ships in the browser bundle. */
    async noteBelongsToCaller(noteId: string): Promise<boolean> {
      const { data, error } = await supabase
        .from("notes")
        .select("id")
        .eq("id", noteId)
        .maybeSingle();
      if (error) throw error;
      return data !== null;
    },

    /** DEMO MODE, per visitor: every question this anonymous session has ever
     *  asked, with no time window. RLS scopes it to the caller, so this is the
     *  visitor's own count and nobody else's — no user_id filter, same as the
     *  rate limit above.
     *
     *  Deliberately unbounded in time where countRecentUserMessages is a
     *  rolling minute: a demo allowance is a budget for the visit, not a speed
     *  limit. Waiting does not earn more questions. */
    async countVisitorQuestions(): Promise<number> {
      const { count, error } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("role", "user");
      if (error) throw error;
      return count ?? 0;
    },

    /** DEMO MODE, globally: every question asked this calendar month by any
     *  anonymous visitor.
     *
     *  An RPC rather than a query, and that is forced rather than chosen. The
     *  select policy on chat_messages scopes the table to the caller, so a
     *  visitor counting rows here would only ever see their own — the number
     *  countVisitorQuestions already has. Counting across visitors has to leave
     *  RLS behind, which is what the security definer function does. It returns
     *  one integer and exposes no rows. See supabase/schemas/chat_messages.sql.
     */
    async countDemoQuestionsThisMonth(): Promise<number> {
      const { data, error } = await supabase.rpc("demo_questions_this_month");
      if (error) throw error;
      return (data as number | null) ?? 0;
    },

    /** Returns the new row's id so the caller can undo this exact insert if
     *  the model call then fails. See deleteMessage below. */
    async insertUserMessage(
      noteId: string,
      ownerId: string,
      content: string,
      scope: ChatScope,
    ): Promise<string> {
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({
          note_id: noteId,
          user_id: ownerId,
          role: "user",
          content,
          scope,
        })
        .select("id")
        .single();
      if (error) throw error;
      return (data as { id: string }).id;
    },

    /** Removes one message by id. The ONLY caller is the route's rollback of
     *  a user turn whose model call failed — see the comment there for why an
     *  orphaned user turn is worth a delete rather than being left in place.
     *
     *  No user_id filter, per this file's header: RLS scopes the delete, and
     *  chat_messages carries a per-operation delete policy for exactly this.
     */
    async deleteMessage(id: string): Promise<void> {
      const { error } = await supabase
        .from("chat_messages")
        .delete()
        .eq("id", id);
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
        // The fallback MATCHES lib/notes/note-view-model.ts:60 on purpose.
        // It numbers from 1; if this numbered from 0, a note whose chunks
        // lack `seq` would show Claude [0] for every line while the client
        // numbered them 1..N — so every [[cite:t…]] would drop and the
        // ungrounded notice would fire on every answer.
        .map((r, index) => ({
          seq: r.metadata?.seq ?? index + 1,
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

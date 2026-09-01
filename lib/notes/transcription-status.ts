import { createClient } from "@/lib/supabase/client";
import type { ProcessingStatus } from "@/lib/notes/view-types";

/**
 * Read one note's `processing_status` from the browser.
 *
 * Same shape as lib/notes/audio-playback.ts, for the same reason: the BROWSER
 * Supabase client, so the read runs as the signed-in user and the four policies
 * on public.notes are what authorise it. No fetch, no API client, no JSON
 * route — the Supabase SDK is this app's only data path.
 *
 * This is NOT a subscription. Realtime stays deferred (docs/ROADMAP.md); what
 * this serves is a bounded poll of ONE row on the page the user is looking at,
 * started by their own click or by finding the note already 'analyzing'. The
 * polling lifetime and its cap live in the component that owns them.
 *
 * No .eq("user_id", ...): RLS supplies ownership, and a redundant filter would
 * mask an RLS failure rather than expose it. Somebody else's note therefore
 * reads as null — the same as a note that does not exist, which is correct.
 */

export interface StatusReader {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): Promise<{
          data: { processing_status: ProcessingStatus } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

function browserReader(): StatusReader {
  return createClient() as unknown as StatusReader;
}

/** Null means "no row visible to this user" — not an error to throw. A genuine
 *  transport or permission failure still throws, so a poll that is quietly
 *  broken cannot look like a note that is quietly still working. */
export async function readProcessingStatus(
  noteId: string,
  reader: StatusReader = browserReader(),
): Promise<ProcessingStatus | null> {
  const { data, error } = await reader
    .from("notes")
    .select("processing_status")
    .eq("id", noteId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read the note's status: ${error.message}`);
  }

  return data?.processing_status ?? null;
}

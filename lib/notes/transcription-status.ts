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

/** `processing_status` is typed as a bare string, not as ProcessingStatus.
 *  This describes what comes back OVER THE WIRE, and the wire carries whatever
 *  notes_processing_status_check currently allows. Declaring the union here
 *  would assert a fact about the database that nothing checks — a value added
 *  to the constraint in SQL but not to view-types.ts would arrive typed as a
 *  ProcessingStatus and the polling component would branch on a status it has
 *  no case for. The narrowing below is where the claim is actually made. */
export interface StatusReader {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        /** PromiseLike, not Promise. postgrest-js returns a PostgrestBuilder,
         *  which is a thenable and has no .catch or .finally. Declaring a full
         *  Promise here is what forced the old `as unknown as` double cast:
         *  the compiler was right that the shapes did not overlap, and the cast
         *  silenced it rather than fixing it. `await` needs only a thenable. */
        maybeSingle(): PromiseLike<{
          data: { processing_status: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
}

/** The runtime half of ProcessingStatus. Both must move together, so they are
 *  cross-checked: the `satisfies` fails to compile if this list drifts from the
 *  union, and the union's own docblock points at the SQL check constraint. */
const PROCESSING_STATUSES = [
  "local",
  "uploading",
  "analyzing",
  "completed",
  "failed",
] as const satisfies readonly ProcessingStatus[];

function isProcessingStatus(value: string): value is ProcessingStatus {
  return (PROCESSING_STATUSES as readonly string[]).includes(value);
}

/** An adapter, not a cast.
 *
 *  This used to be `createClient() as unknown as StatusReader`, which disabled
 *  type checking in both directions: supabase-js could rename maybeSingle or
 *  reshape the builder chain and this would still compile, then fail at runtime
 *  on the note page. Narrowing it to a single cast is not available — the
 *  client's `from` is generic enough that comparing it against any structural
 *  type trips TS2589 ("type instantiation is excessively deep").
 *
 *  Forwarding each call instead means every step is checked against the real
 *  API at the point it is made, which is the guarantee the cast was pretending
 *  to give. Four lines of plumbing for a compile error instead of a white
 *  screen. */
function browserReader(): StatusReader {
  const db = createClient();

  return {
    from: (table) => ({
      select: (columns) => ({
        eq: (column, value) => ({
          maybeSingle: () =>
            db.from(table).select(columns).eq(column, value).maybeSingle(),
        }),
      }),
    }),
  };
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

  if (!data) return null;

  // Throw rather than pass an unrecognised value through. Same rule as the
  // error branch above: a poll that is quietly broken must not be able to look
  // like a note that is quietly still working. A status the app does not know
  // would otherwise reach the component's fallthrough and read as "still
  // analyzing" forever.
  if (!isProcessingStatus(data.processing_status)) {
    throw new Error(
      `Unknown processing_status "${data.processing_status}" for note ${noteId}.`,
    );
  }

  return data.processing_status;
}

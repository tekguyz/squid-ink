import { notFound } from "next/navigation";
import { NoteDetailShell } from "@/components/note-detail/note-detail-shell";
import { getNote } from "@/lib/notes/get-note";
import { createClient } from "@/lib/supabase/server";
import { createChatPorts } from "@/lib/chat/ports";

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const note = await getNote(id);

  // A note owned by someone else is filtered out by RLS, so it arrives here
  // as null and renders as not-found — no existence leak.
  if (!note) notFound();

  // Read server-side, on the same request, so a refresh mid-conversation
  // restores the whole thread. The client never persists chat anywhere.
  const history = await createChatPorts(await createClient()).readHistory(id);

  return <NoteDetailShell note={note} history={history} />;
}

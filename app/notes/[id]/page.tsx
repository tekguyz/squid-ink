import { notFound } from "next/navigation";
import { NoteDetailShell } from "@/components/note-detail/note-detail-shell";
import { getNote } from "@/lib/notes/get-note";

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

  return <NoteDetailShell note={note} />;
}

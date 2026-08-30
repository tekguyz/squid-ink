import { NoteDetailShell } from "@/components/note-detail/note-detail-shell";
import { mockNote } from "@/lib/mock/note";

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params;
  return <NoteDetailShell note={mockNote} />;
}

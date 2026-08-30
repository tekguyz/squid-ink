import { redirect } from "next/navigation";
import { getLatestNoteId } from "@/lib/notes/get-latest-note-id";

export default async function Home() {
  // Was a hardcoded mock slug. Note ids are database UUIDs now, so the entry
  // point has to ask which note actually exists.
  const id = await getLatestNoteId();
  if (id) redirect(`/notes/${id}`);

  return (
    <main className="bg-paper text-ink mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 p-6">
      <h1 className="font-header text-ink">No notes yet</h1>
      <p className="font-body text-ink-2">
        Once a recording finishes processing, it will show up here.
      </p>
    </main>
  );
}

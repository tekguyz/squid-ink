import { notFound } from "next/navigation";
import { NoteDetailShell } from "@/components/note-detail/note-detail-shell";
import { getNote } from "@/lib/notes/get-note";
import { createClient } from "@/lib/supabase/server";
import { createChatPorts } from "@/lib/chat/ports";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDemoVisitor } from "@/lib/auth/demo-visitor";
import { DEMO_MAX_QUESTIONS_PER_VISITOR } from "@/lib/chat/limits";

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
  const ports = createChatPorts(await createClient());
  const demo = isDemoVisitor(await getCurrentUser());
  const [history, asked] = await Promise.all([
    ports.readHistory(id),
    // The same count the route's per-visitor cap reads, so the number shown
    // is the number enforced. Only a demo visitor pays for the query.
    demo ? ports.countVisitorQuestions() : Promise.resolve(0),
  ]);

  return (
    <NoteDetailShell
      note={note}
      history={history}
      demoQuestionsLeft={demo ? Math.max(0, DEMO_MAX_QUESTIONS_PER_VISITOR - asked) : null}
    />
  );
}

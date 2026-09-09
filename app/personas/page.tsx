import { PersonasShell } from "@/components/personas/personas-shell";
import { getPersonasScreen } from "@/lib/notes/get-personas-screen";

/**
 * Personas, App Surfaces 03. The lenses the generation pipeline reads have
 * been rows since 2026-08-31; this is the first screen that shows them.
 *
 * Read-only. Every control that would write renders disabled and says so —
 * see components/personas/persona-anatomy.tsx.
 */
export const metadata = { title: "Personas" };

export default async function PersonasPage() {
  return <PersonasShell screen={await getPersonasScreen()} />;
}

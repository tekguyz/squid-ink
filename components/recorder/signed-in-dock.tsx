import { RecorderDock } from "@/components/recorder/recorder-dock";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * The recorder dock, only with a session (issue #60). The landing page sits at
 * "/" with none, and a Record pill there would offer a recording with nowhere
 * to go.
 *
 * Its own async server component, rendered by app/layout.tsx inside a
 * Suspense boundary, so the auth call never holds up the page shell. Sign-in
 * and sign-out are Server Actions that write cookies, which re-render the
 * layout, so the answer does not go stale.
 */
export async function SignedInDock() {
  return (await getCurrentUser()) ? <RecorderDock /> : null;
}

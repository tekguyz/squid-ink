import { confirmEmailLink } from "@/app/auth/actions/email-link";
import { AuthHeading, AuthSheet, PRIMARY } from "@/components/auth/auth-sheet";

export const metadata = { title: "Continue" };

/** Landing page for an emailed link. Renders a button and verifies NOTHING —
 *  the reason is in app/auth/actions/email-link.ts. */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash = "", type = "" } = await searchParams;
  const recovery = type === "recovery";

  return (
    <AuthSheet>
      <AuthHeading
        eyebrow={recovery ? "Password recovery" : "Email confirmation"}
        title={recovery ? "Reset your password" : "Confirm your email"}
      >
        {recovery
          ? "Press the button to choose a new password. The link works once."
          : "Press the button to finish setting up your account. The link works once."}
      </AuthHeading>
      <form action={confirmEmailLink} className="flex flex-col">
        <input type="hidden" name="token_hash" value={token_hash} />
        <input type="hidden" name="type" value={type} />
        <button type="submit" className={PRIMARY}>
          {recovery ? "Continue to reset your password" : "Confirm my email"}
        </button>
      </form>
    </AuthSheet>
  );
}

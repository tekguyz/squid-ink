import { confirmEmailLink } from "@/app/auth/actions/email-link";

export const metadata = { title: "Continue" };

/** Landing page for an emailed link. Renders a button and verifies NOTHING —
 *  the reason is in app/auth/actions/email-link.ts. Plumbing, like /login:
 *  the designed Auth surface restyles it. */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}) {
  const { token_hash = "", type = "" } = await searchParams;
  const label = type === "recovery" ? "Continue to reset your password" : "Confirm my email";

  return (
    <main className="bg-paper text-ink mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="font-header text-ink">Squid Ink</h1>
      <form action={confirmEmailLink} className="flex flex-col gap-3">
        <input type="hidden" name="token_hash" value={token_hash} />
        <input type="hidden" name="type" value={type} />
        <button
          type="submit"
          className="border border-control-edge bg-accent text-on-accent font-body px-3 py-2"
        >
          {label}
        </button>
      </form>
    </main>
  );
}

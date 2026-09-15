import { LoginForm } from "./login-form";
import { safeNext } from "@/lib/auth/safe-next";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <main className="bg-paper text-ink mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="font-header text-ink">Squid Ink</h1>
      {/* Set only by app/auth/actions/email-link.ts. */}
      {error === "link_invalid" ? (
        <p role="alert" className="font-body text-notice">
          That link is wrong, used or expired. Ask for a new one.
        </p>
      ) : null}
      <LoginForm next={safeNext(next)} />
    </main>
  );
}

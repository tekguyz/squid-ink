import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // Only same-origin paths, so a crafted ?next= cannot bounce a signed-in
  // user to another site.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <main className="bg-paper text-ink mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="font-header text-ink">Sign in</h1>
      <p className="font-body text-ink-2">
        We&rsquo;ll email you a link. No password needed.
      </p>
      {error ? (
        <p role="alert" className="font-body text-notice">
          That link did not work. Request a new one.
        </p>
      ) : null}
      <LoginForm next={safeNext} />
    </main>
  );
}

import { AuthSheet } from "@/components/auth/auth-sheet";
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
    <AuthSheet>
      <LoginForm
        next={safeNext(next)}
        // Set only by app/auth/actions/email-link.ts.
        notice={error === "link_invalid" ? "That link is wrong, used or expired. Ask for a new one." : null}
      />
    </AuthSheet>
  );
}

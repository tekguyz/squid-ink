import { NewPasswordForm } from "./new-password-form";

export const metadata = { title: "Choose a new password" };

/** Where a verified password-reset link lands. Under /login so it is public to
 *  the proxy and outside the first-run gate; `setNewPassword` itself refuses a
 *  request with no session. */
export default function NewPasswordPage() {
  return (
    <main className="bg-paper text-ink mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="font-header text-ink">Choose a new password</h1>
      <NewPasswordForm />
    </main>
  );
}

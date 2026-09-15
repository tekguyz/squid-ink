import { AuthHeading, AuthSheet } from "@/components/auth/auth-sheet";
import { NewPasswordForm } from "./new-password-form";

export const metadata = { title: "Choose a new password" };

/** Where a verified password-reset link lands. Under /login so it is public to
 *  the proxy and outside the first-run gate; `setNewPassword` itself refuses a
 *  request with no session. */
export default function NewPasswordPage() {
  return (
    <AuthSheet>
      <AuthHeading eyebrow="Password recovery" title="Choose a new password">
        Type the new password twice.
      </AuthHeading>
      <NewPasswordForm />
    </AuthSheet>
  );
}

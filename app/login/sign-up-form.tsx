"use client";

import { useState, useTransition } from "react";
import { signUpWithPassword } from "@/app/auth/actions/sign-up";
import { EMAIL_LINK_EXPIRY_MINUTES } from "@/lib/auth/email-link-policy";
import {
  ADDRESS, AuthHeading, AuthNotice, FIELD, LABEL, LINK, PRIMARY, STACK,
} from "@/components/auth/auth-sheet";
import { FAILURE_TEXT } from "./failure-text";
import { MISMATCH, PasswordFields } from "./password-fields";

/** Signup, the Auth surface's create-account state. Unreachable while
 *  SIGNUP_OPEN in login-form.tsx is false; kept styled and working so that
 *  reopening signup is a flag, not a rebuild. */
export function SignUpForm({ onBack }: { onBack: () => void }) {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) return setMessage(MISMATCH);
    setMessage(null);
    startTransition(async () => {
      const result = await signUpWithPassword({ email, password });
      if (result.ok) setSent(true);
      else setMessage(FAILURE_TEXT[result.failure]);
    });
  }

  if (sent) {
    return (
      <>
        <AuthHeading eyebrow="Create account" title="Check your email">
          We sent a confirmation link to <span className={ADDRESS}>{email}</span>. It expires in{" "}
          {EMAIL_LINK_EXPIRY_MINUTES} minutes. Open it, then sign in with your password.
        </AuthHeading>
        <div className="mt-[18px]">
          <button type="button" onClick={onBack} className={LINK}>Back to sign in</button>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthHeading title="Create an account" />
      <form onSubmit={onSubmit} className="flex flex-col">
        <div className={STACK}>
          <div>
            <label htmlFor="su-email" className={LABEL}>Email address</label>
            <input id="su-email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
          </div>
          <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        </div>
        <button type="submit" disabled={pending} className={PRIMARY}>Create account</button>
        <div className="mt-[14px] flex flex-col gap-[10px]">
          {message ? <AuthNotice>{message}</AuthNotice> : null}
          <button type="button" onClick={onBack} className={LINK}>Back to sign in</button>
        </div>
      </form>
    </>
  );
}

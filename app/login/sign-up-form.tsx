"use client";

import { useState, useTransition } from "react";
import { signUpWithPassword } from "@/app/auth/actions/sign-up";
import { EMAIL_LINK_EXPIRY_MINUTES } from "@/lib/auth/email-link-policy";
import { BUTTON, FAILURE_TEXT, FIELD, LINK } from "./failure-text";

/** Plumbing for signup — see login-form.tsx. */
export function SignUpForm({ onBack }: { onBack: () => void }) {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await signUpWithPassword({ email, password });
      if (result.ok) setSent(true);
      else setMessage(FAILURE_TEXT[result.failure]);
    });
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-body text-ink-2">
          We sent a confirmation link to {email}. It expires in {EMAIL_LINK_EXPIRY_MINUTES} minutes.
          Open it, then sign in with your password.
        </p>
        <button type="button" onClick={onBack} className={LINK}>Back to sign in</button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <h2 className="font-header text-ink">Create an account</h2>
      <label htmlFor="su-email" className="font-body text-ink-2">Email address</label>
      <input id="su-email" type="email" required autoComplete="email"
        value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
      <label htmlFor="su-password" className="font-body text-ink-2">Password</label>
      <input id="su-password" type="password" required autoComplete="new-password"
        value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD} />
      <button type="submit" disabled={pending} className={BUTTON}>Create account</button>
      {message ? <p role="alert" className="font-body text-notice">{message}</p> : null}
      <button type="button" onClick={onBack} className={LINK}>Back to sign in</button>
    </form>
  );
}

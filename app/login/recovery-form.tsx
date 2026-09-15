"use client";

import { useState, useTransition } from "react";
import { requestPasswordReset } from "@/app/auth/actions/recovery";
import { EMAIL_LINK_EXPIRY_MINUTES } from "@/lib/auth/email-link-policy";
import { BUTTON, FAILURE_TEXT, FIELD, LINK } from "./failure-text";

/** Plumbing for password reset — see login-form.tsx and the three steps in
 *  app/auth/actions/recovery.ts. */
export function RecoveryForm({ onBack }: { onBack: () => void }) {
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await requestPasswordReset({ email });
      if (result.ok) setSent(true);
      else setMessage(FAILURE_TEXT[result.failure]);
    });
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <p className="font-body text-ink-2">
          If {email} has an account, we sent it a reset link. It expires in{" "}
          {EMAIL_LINK_EXPIRY_MINUTES} minutes.
        </p>
        <button type="button" onClick={onBack} className={LINK}>Back to sign in</button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <h2 className="font-header text-ink">Reset your password</h2>
      <label htmlFor="rc-email" className="font-body text-ink-2">Email address</label>
      <input id="rc-email" type="email" required autoComplete="email"
        value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
      <button type="submit" disabled={pending} className={BUTTON}>Send reset link</button>
      {message ? <p role="alert" className="font-body text-notice">{message}</p> : null}
      <button type="button" onClick={onBack} className={LINK}>Back to sign in</button>
    </form>
  );
}

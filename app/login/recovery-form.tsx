"use client";

import { useState, useTransition } from "react";
import { requestPasswordReset } from "@/app/auth/actions/recovery";
import { EMAIL_LINK_EXPIRY_MINUTES } from "@/lib/auth/email-link-policy";
import {
  ADDRESS, AuthHeading, AuthNotice, FIELD, LABEL, LINK, PRIMARY, STACK,
} from "@/components/auth/auth-sheet";
import { FAILURE_TEXT } from "./failure-text";

/** Password reset, the Auth surface's recovery state — see the three steps in
 *  app/auth/actions/recovery.ts. "Check your email" is the drawing's; its code
 *  boxes are not, because the email carries a link. */
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
      <>
        <AuthHeading eyebrow="Password recovery" title="Check your email">
          If <span className={ADDRESS}>{email}</span> has an account, we sent it a reset link.
          It expires in {EMAIL_LINK_EXPIRY_MINUTES} minutes.
        </AuthHeading>
        <div className="mt-[18px]">
          <button type="button" onClick={onBack} className={LINK}>Back to sign in</button>
        </div>
      </>
    );
  }

  return (
    <>
      <AuthHeading eyebrow="Password recovery" title="Reset your password">
        We email you a link. Open it to choose a new password.
      </AuthHeading>
      <form onSubmit={onSubmit} className="flex flex-col">
        <div className={STACK}>
          <div>
            <label htmlFor="rc-email" className={LABEL}>Email address</label>
            <input id="rc-email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
          </div>
        </div>
        <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>
          {pending ? "Sending…" : "Send reset link"}
        </button>
        <div className="mt-[14px] flex flex-col gap-[10px]">
          {message ? <AuthNotice>{message}</AuthNotice> : null}
          <button type="button" onClick={onBack} className={LINK}>Back to sign in</button>
        </div>
      </form>
    </>
  );
}

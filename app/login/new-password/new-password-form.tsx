"use client";

import { useState, useTransition } from "react";
import { setNewPassword } from "@/app/auth/actions/recovery";
import { BUTTON, FAILURE_TEXT, FIELD } from "../failure-text";

/** Plumbing — see app/login/login-form.tsx. */
export function NewPasswordForm() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      // Resolves only on failure; success redirects.
      const result = await setNewPassword({ password });
      if (result && !result.ok) setMessage(FAILURE_TEXT[result.failure]);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor="new-password" className="font-body text-ink-2">New password</label>
      <input id="new-password" type="password" required autoComplete="new-password"
        value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Saving…" : "Save password"}
      </button>
      {message ? <p role="alert" className="font-body text-notice">{message}</p> : null}
    </form>
  );
}

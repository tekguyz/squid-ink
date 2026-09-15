"use client";

import { useState, useTransition } from "react";
import { setNewPassword } from "@/app/auth/actions/recovery";
import { BUTTON, FAILURE_TEXT } from "../failure-text";
import { MISMATCH, PasswordFields } from "../password-fields";

/** Plumbing — see app/login/login-form.tsx. */
export function NewPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) return setMessage(MISMATCH);
    setMessage(null);
    startTransition(async () => {
      // Resolves only on failure; success redirects.
      const result = await setNewPassword({ password });
      if (result && !result.ok) setMessage(FAILURE_TEXT[result.failure]);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Saving…" : "Save password"}
      </button>
      {message ? <p role="alert" className="font-body text-notice">{message}</p> : null}
    </form>
  );
}

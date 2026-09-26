"use client";

import { useState, useTransition } from "react";
import { setNewPassword } from "@/app/auth/actions/recovery";
import { AuthNotice, PRIMARY, STACK } from "@/components/auth/auth-sheet";
import { FAILURE_TEXT } from "../failure-text";
import { MISMATCH, PasswordFields } from "../password-fields";

/** The last step of a reset — see app/login/new-password/page.tsx. */
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
    <form onSubmit={onSubmit} className="flex flex-col">
      <div className={STACK}>
        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
      </div>
      <button type="submit" disabled={pending} aria-busy={pending} className={PRIMARY}>
        {pending ? "Saving…" : "Save password"}
      </button>
      {message ? <div className="mt-[14px]"><AuthNotice>{message}</AuthNotice></div> : null}
    </form>
  );
}

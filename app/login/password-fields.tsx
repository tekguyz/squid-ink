"use client";

import { useId, useState } from "react";
import { FIELD } from "./failure-text";

/** A NEW password, typed twice, with a Show toggle — for signup and for a
 *  reset. Not for sign-in, which asks once. Plumbing like the rest of
 *  app/login; the designed Auth surface restyles it and keeps the behaviour.
 *
 *  The parent owns both values and checks `password === confirm` before
 *  calling an action, so a mismatch never spends a Supabase request — or, on
 *  a reset, the recovery session. */
export function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
}: {
  password: string;
  confirm: string;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  const type = shown ? "text" : "password";

  return (
    <>
      <label htmlFor={`${id}-pw`} className="font-body text-ink-2">Password</label>
      <input id={`${id}-pw`} type={type} required autoComplete="new-password"
        value={password} onChange={(e) => onPassword(e.target.value)} className={FIELD} />
      <label htmlFor={`${id}-confirm`} className="font-body text-ink-2">Type it again</label>
      <input id={`${id}-confirm`} type={type} required autoComplete="new-password"
        value={confirm} onChange={(e) => onConfirm(e.target.value)} className={FIELD} />
      <label className="font-body text-ink-2 flex items-center gap-2">
        <input type="checkbox" checked={shown} onChange={(e) => setShown(e.target.checked)} />
        Show password
      </label>
    </>
  );
}

export const MISMATCH = "The two passwords do not match.";

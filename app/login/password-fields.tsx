"use client";

import { useId, useState } from "react";
import { CHECK_ROW, CHECKBOX, FIELD, LABEL } from "@/components/auth/auth-sheet";

/** A NEW password, typed twice, with a Show toggle — for signup and for a
 *  reset. Not for sign-in, which asks once. Renders field groups only; the
 *  caller's STACK spaces them.
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
      <div>
        <label htmlFor={`${id}-pw`} className={LABEL}>Password</label>
        <input id={`${id}-pw`} type={type} required autoComplete="new-password"
          value={password} onChange={(e) => onPassword(e.target.value)} className={FIELD} />
      </div>
      <div>
        <label htmlFor={`${id}-confirm`} className={LABEL}>Type it again</label>
        <input id={`${id}-confirm`} type={type} required autoComplete="new-password"
          value={confirm} onChange={(e) => onConfirm(e.target.value)} className={FIELD} />
      </div>
      <label className={CHECK_ROW}>
        <input type="checkbox" checked={shown} onChange={(e) => setShown(e.target.checked)} className={CHECKBOX} />
        Show password
      </label>
    </>
  );
}

export const MISMATCH = "The two passwords do not match.";

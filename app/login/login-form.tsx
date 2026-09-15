"use client";

import { useState, useTransition } from "react";
import { signInWithPassword } from "@/app/auth/actions/sign-in";
import { resendConfirmationLink } from "@/app/auth/actions/sign-up";
import {
  AuthHeading, AuthNotice, CHECK_ROW, CHECKBOX, FIELD, LABEL, LINK, PRIMARY, STACK,
} from "@/components/auth/auth-sheet";
import { FAILURE_TEXT } from "./failure-text";
import { RecoveryForm } from "./recovery-form";
import { SignUpForm } from "./sign-up-form";

/** Whether /login offers "Create an account". Off because public signup is
 *  closed until a pricing or usage-cap model exists (docs/DECISIONS.md § Auth).
 *  Hidden, not deleted: SignUpForm and its action are intact, so reopening is
 *  this one line plus the Supabase dashboard switch. */
const SIGNUP_OPEN = false;

/** Sign-in, the Auth surface's first state — App Surfaces 04, see
 *  components/auth/auth-sheet.tsx. It swaps in the recovery and signup states
 *  in place rather than routing, so the email typed here is not lost. */
export function LoginForm({ next, notice }: { next: string; notice: string | null }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "recover">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(notice);
  const [pending, startTransition] = useTransition();

  if (mode === "sign-up") return <SignUpForm onBack={() => setMode("sign-in")} />;
  if (mode === "recover") return <RecoveryForm onBack={() => setMode("sign-in")} />;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      // Resolves only on failure; success redirects.
      const result = await signInWithPassword({ email, password, remember, next });
      if (!result) return;
      setUnconfirmed(result.failure === "email_not_confirmed");
      setMessage(FAILURE_TEXT[result.failure]);
    });
  }

  function onResend() {
    startTransition(async () => {
      const result = await resendConfirmationLink({ email });
      setUnconfirmed(false);
      setMessage(result.ok ? `We sent a new confirmation link to ${email}.` : FAILURE_TEXT[result.failure]);
    });
  }

  return (
    <>
      <AuthHeading title="Sign in" />
      <form onSubmit={onSubmit} className="flex flex-col">
        <div className={STACK}>
          <div>
            <label htmlFor="email" className={LABEL}>Email address</label>
            <input id="email" name="email" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
          </div>
          <div>
            <label htmlFor="password" className={LABEL}>Password</label>
            <input id="password" name="password" type="password" required autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD} />
          </div>
          <label className={CHECK_ROW}>
            <input type="checkbox" name="remember" checked={remember}
              onChange={(e) => setRemember(e.target.checked)} className={CHECKBOX} />
            Keep me signed in
          </label>
        </div>
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
        <div className="mt-[14px] flex flex-col gap-[10px]">
          {message ? <AuthNotice>{message}</AuthNotice> : null}
          {unconfirmed ? (
            <button type="button" onClick={onResend} disabled={pending} className={LINK}>
              Send a new confirmation link
            </button>
          ) : null}
          <button type="button" onClick={() => setMode("recover")} className={LINK}>
            Forgot your password?
          </button>
          {SIGNUP_OPEN ? (
            <button type="button" onClick={() => setMode("sign-up")} className={LINK}>
              Create an account
            </button>
          ) : null}
        </div>
      </form>
    </>
  );
}

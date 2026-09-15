"use client";

import { useState, useTransition } from "react";
import { signInWithPassword } from "@/app/auth/actions/sign-in";
import { resendConfirmationLink } from "@/app/auth/actions/sign-up";
import { BUTTON, FAILURE_TEXT, FIELD, LINK } from "./failure-text";
import { RecoveryForm } from "./recovery-form";
import { SignUpForm } from "./sign-up-form";

/** Deliberately plain. The designed Auth surface is a separate UI pass (App
 *  Surfaces 04) — this is plumbing so the password and email-link actions in
 *  app/auth/actions/ have a way to be reached, and anything decorative here
 *  would only have to be undone. Existing tokens only, no new colour values. */
export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"sign-in" | "sign-up" | "recover">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor="email" className="font-body text-ink-2">Email address</label>
      <input id="email" name="email" type="email" required autoComplete="email"
        value={email} onChange={(e) => setEmail(e.target.value)} className={FIELD} />
      <label htmlFor="password" className="font-body text-ink-2">Password</label>
      <input id="password" name="password" type="password" required autoComplete="current-password"
        value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD} />
      <label className="font-body text-ink-2 flex items-center gap-2">
        <input type="checkbox" name="remember" checked={remember}
          onChange={(e) => setRemember(e.target.checked)} />
        Keep me signed in on this Mac
      </label>
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      {message ? <p role="alert" className="font-body text-notice">{message}</p> : null}
      {unconfirmed ? (
        <button type="button" onClick={onResend} disabled={pending} className={LINK}>
          Send a new confirmation link
        </button>
      ) : null}
      <button type="button" onClick={() => setMode("recover")} className={LINK}>
        Forgot your password?
      </button>
      <button type="button" onClick={() => setMode("sign-up")} className={LINK}>
        Create an account
      </button>
    </form>
  );
}

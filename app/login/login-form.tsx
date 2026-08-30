"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type State = { status: "idle" | "sending" | "sent" | "error"; message?: string };

/** Deliberately plain. The designed Auth surface is a separate Core UX/UI
 *  pass — this is plumbing, and anything decorative here would only have to
 *  be undone. Existing tokens only, no new colour values. */
export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "sending" });

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    });

    setState(
      error
        ? { status: "error", message: error.message }
        : { status: "sent" },
    );
  }

  if (state.status === "sent") {
    return (
      <p className="font-body text-ink-2">
        Check your email for a sign-in link.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor="email" className="font-body text-ink-2">
        Email address
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="border border-rule bg-paper text-ink font-body px-3 py-2"
      />
      <button
        type="submit"
        disabled={state.status === "sending"}
        className="border border-rule bg-accent text-on-accent font-body px-3 py-2 disabled:opacity-60"
      >
        {state.status === "sending" ? "Sending…" : "Send sign-in link"}
      </button>
      {state.status === "error" ? (
        <p role="alert" className="font-body text-notice">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

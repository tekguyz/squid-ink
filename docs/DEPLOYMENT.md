# Deployment

**Source of truth for redirect and hosting config.** This supersedes
DECISIONS.md § Deployment, which is kept in the owner's Claude.ai planning
Project and therefore cannot be read from a session working in this repo. When
the two disagree, this file wins — and DECISIONS.md should be trimmed to point
here rather than restating anything below.

Recorded 2026-08-30. Every value here was **measured**, not transcribed. The
recipes that measured them are at the bottom; re-run them rather than trusting
this file after any change.

## Vercel

| | |
|---|---|
| Project | `tekguyz/squid-ink` |
| Production URL | `https://squid-ink.vercel.app` |
| Deploys from | GitHub `main`, via the Git integration |
| Repo | `https://github.com/tekguyz/squid-ink` |

Three aliases point at the current production deployment:
`squid-ink.vercel.app`, `squid-ink-tekguyz.vercel.app`, and
`squid-ink-git-main-tekguyz.vercel.app`.

Per-deployment URLs are named from the **npm package** name (`squid-ink` in
`package.json`), truncated — they read `https://squid-<hash>-tekguyz.vercel.app`.
Note the prefix is `squid-`, not `squid-ink-`. This is the detail that broke
sign-in on 2026-08-30; see below.

### Environment variables

Both are set for Preview and Production:

- `NEXT_PUBLIC_SUPABASE_URL` — `https://pbwvvakzbrimmdntqxxn.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

`SUPABASE_SECRET_KEY` is **correctly absent** from Vercel. It bypasses RLS and
belongs only in the gitignored `.env.local`, where `scripts/verify-rls.mjs`
reads it. It must never carry a `NEXT_PUBLIC_` prefix — Next.js ships every such
variable to the browser.

The repo holds no `.vercel` directory and no `vercel.json`. Vercel CLI commands
therefore need `--project squid-ink --scope tekguyz` explicitly; without them the
CLI reports the codebase as unlinked.

## Supabase

| | |
|---|---|
| Project | Squid Ink |
| Ref | `pbwvvakzbrimmdntqxxn` |
| Region | `us-east-2` |
| API URL | `https://pbwvvakzbrimmdntqxxn.supabase.co` |

### Authentication → URL Configuration

**Site URL:** `https://squid-ink.vercel.app`

**Redirect URLs:**

```
https://squid-ink.vercel.app/**
https://squid-ink-*.vercel.app/**
https://squid-*-tekguyz.vercel.app/**
http://localhost:3000/**
```

Measured behaviour, 2026-08-30:

| Origin | Honoured |
|---|---|
| `https://squid-ink.vercel.app` | yes |
| `https://squid-ink-tekguyz.vercel.app` | yes |
| `https://squid-ink-git-main-tekguyz.vercel.app` | yes |
| `https://squid-ihtbfia0v-tekguyz.vercel.app` | yes |
| `http://localhost:3000` | yes |
| `http://localhost:3001` | no |
| `https://squid-anything-else.vercel.app` | no |
| `https://evil.example.com` | no |

The third pattern requires the `-tekguyz` suffix, so it covers Vercel's own
deployment hosts and nothing wider. It also makes the second pattern redundant in
practice — `squid-ink-tekguyz` and `squid-ink-git-main-tekguyz` both match
`squid-*-tekguyz` — but removing an entry is a change worth measuring, not
assuming.

**A non-allowlisted `redirect_to` does not error. It is silently replaced with
the Site URL.** That is what makes this config dangerous to get wrong, and why
the table above is measured rather than read off a dashboard.

### Why the third pattern exists

Until 2026-08-30 the allowlist covered `squid-ink-*.vercel.app` only. Vercel's
per-deployment URLs are `squid-<hash>-tekguyz.vercel.app`, which does not match.
Signing in on a deployment URL therefore sent an `emailRedirectTo` Supabase
rejected, Supabase substituted the Site URL, and the returning magic link landed
on a different origin than the one holding the PKCE code-verifier cookie. The
exchange failed with `400 pkce_code_verifier_not_found` and no useful signal
anywhere.

**Renaming the npm package or the Vercel project changes the deployment prefix
and breaks this pattern again, silently.** If either name changes, re-measure.

### Mail

Supabase's built-in mailer is rate-limited and not production-grade. Custom SMTP
(Resend) is not configured. Fine at owner-plus-one-friend scale; revisit before
any real user volume.

## Signing in — rules that are not obvious

- **One browser, start to finish.** PKCE writes the code verifier to a cookie in
  the browser that called `signInWithOtp`. Requesting the link in one browser or
  profile and opening it in another gives `400 pkce_code_verifier_not_found`,
  which reads like a server fault and is not one.
- `@supabase/ssr` 0.12.5 writes **several** verifier cookies under
  `sb-<ref>-auth-token`: a per-flow slot per pending sign-in
  (`-flow-<id>-code-verifier`), an index (`-flows-code-verifier`), and a fixed
  key (`-code-verifier`). Code that probes one guessed name will find nothing.
- A magic link is single-use and is spent by whoever issues the first `GET`. See
  docs/KNOWN_GAPS.md, "Magic-link tokens are spent by a GET" — still one
  unconfirmed sighting, deliberately not acted on.

## Verifying this file

### Redirect config, without the dashboard

`GET /auth/v1/verify` honours an allowlisted `redirect_to` and falls back to the
Site URL otherwise, so a junk token is enough to read both settings. Nothing is
consumed — the token is invalid by construction.

```bash
curl -s -D - -o /dev/null "https://pbwvvakzbrimmdntqxxn.supabase.co/auth/v1/verify?token=bogus&type=magiclink&redirect_to=https%3A%2F%2Fsquid-ink.vercel.app%2Fauth%2Fconfirm" | grep -i '^location'
```

The `Location` echoes the URL back when it is allowlisted, and shows the Site URL
when it is not. Send one probe per origin, and always include a junk domain as a
control — without it, a wide-open allowlist looks identical to a correct one.

### Vercel state

```bash
vercel ls squid-ink --scope tekguyz
```

```bash
vercel env ls production --project squid-ink --scope tekguyz
```

### Runtime errors

`vercel logs <deployment-url> --scope tekguyz` carries only method, path and
status for successful requests. It does **not** contain a Supabase response body,
so an auth failure shows up as a redirect to `/login` and nothing more. Capturing
an actual `error.message` requires temporarily logging it in the route handler
and reverting afterwards — done once on 2026-08-30 (`fc3ac2f`, reverted in
`06479f3`) and worth repeating the same way rather than leaving instrumentation
in production.

---
paths:
  - "lib/auth/**"
  - "app/auth/**"
  - "lib/supabase/**"
  - "app/login/**"
  - "proxy.ts"
  - "supabase/templates/**"
  - "app/notes/actions/demo.ts"
---

# Auth

Email + password sign-in. Emailed **links**, not codes, for account
confirmation and password reset only. Magic-link sign-in is retired
(2026-09-14, `docs/DECISIONS.md` § Auth). Three rules the code alone does not
make obvious — the first two are also stated in `CLAUDE.md` § Supabase → Auth,
because they bite from files this rule's globs do not cover:

- **Every Supabase client writes cookies through `withPersistence`**
  (`lib/auth/session-persistence.ts`): the server client, the proxy and the
  browser client. A new client that uses the library's default cookie
  handling turns an unchecked "Keep me signed in" into a 400-day session on
  its first token refresh.
- **`verifyOtp` is called in one place**, the POST behind `/auth/confirm`
  (`app/auth/actions/email-link.ts`). Never verify on a GET.
  `lib/auth/__tests__/magic-link-retired.test.ts` enforces both this and the
  retirement.
- **The hosted email templates and link lifetime are dashboard settings**,
  mirrored in `supabase/templates/` and `config.toml` and never pushed.
  `node scripts/verify-email-templates.mjs` diffs hosted against the repo.
  `docs/DEPLOYMENT.md` § Auth email.

## Demo visitors (issue #19)

A demo visitor is an **anonymous** sign-in, made only by `enterDemo` in
`app/notes/actions/demo.ts`, the POST behind the landing page's button. Never
on a GET. It refuses when any session exists (`getUser`, so a visitor the
cleanup job deleted gets a fresh visit), and sets `onboarded_at` in the new
identity's metadata so the proxy's onboarding gate lets it through.

**"Allow new users to sign up" is ON, and public signup is still closed.**
Anonymous sign-in does not run with the switch off. The before-user-created
hook `public.hook_only_anonymous_signups` (`supabase/schemas/demo_visitors.sql`)
refuses every non-anonymous signup with a 403, which `sign-up.ts` shows as
`signup_closed`. **Never turn the hook off while the switch is on** — that
reopens public signup. The admin API skips the hook, so dashboard "Add user",
`/api/dev-login` and `scripts/load-demo-owner.mjs` still work.

The one "is this a demo visitor" fact is `isDemoVisitor(user)` in
`lib/auth/demo-visitor.ts` — the `is_anonymous` claim that
`public.is_anon_session()` reads in every write policy. `leaveDemo` signs a
visitor out and goes to tekguyz.com, never to `/login`.

Test the sign-in FORM locally with `RLS_TEST_OWNER_EMAIL` /
`RLS_TEST_OWNER_PASSWORD` from `.env.local` at `/login`. To just reach a
signed-in page, open `/api/dev-login` (`CLAUDE.md` > Commands).

## Deployment interacts with this

`main` auto-deploys to Vercel (`tekguyz/squid-ink`, `https://squid-ink.vercel.app`).
Vercel's own link and config files are absent from the tree, so this is
invisible from the repo — **`docs/DEPLOYMENT.md` is the source of truth** for the
Supabase Site URL, the redirect allowlist, the Vercel environment variables, and
the `curl` recipes that re-measure them without a dashboard. Read it before
changing anything about auth redirects, and never test sign-in on a raw
deployment URL without checking that file first.

---
paths:
  - "lib/auth/**"
  - "app/auth/**"
  - "lib/supabase/**"
  - "app/login/**"
  - "proxy.ts"
  - "supabase/templates/**"
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
  `docs/DEPLOYMENT.md` § Auth email.

Test sign-in locally with `RLS_TEST_OWNER_EMAIL` / `RLS_TEST_OWNER_PASSWORD`
from `.env.local` at `/login`.

## Deployment interacts with this

`main` auto-deploys to Vercel (`tekguyz/squid-ink`, `https://squid-ink.vercel.app`).
Vercel's own link and config files are absent from the tree, so this is
invisible from the repo — **`docs/DEPLOYMENT.md` is the source of truth** for the
Supabase Site URL, the redirect allowlist, the Vercel environment variables, and
the `curl` recipes that re-measure them without a dashboard. Read it before
changing anything about auth redirects, and never test sign-in on a raw
deployment URL without checking that file first.

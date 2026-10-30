---
paths:
  - "supabase/tests/**"
  - "scripts/verify-*.mjs"
  - "scripts/load-demo-owner.mjs"
---

# Integration tests, RLS proofs and leaked test users

Moved out of `CLAUDE.md` on 2026-10-30 (tekguyz/squid-ink#100), unchanged in substance.

## Integration tests

- **Two commands, never the aggregate:** `npm run test:unit`, then `npm run test:integration`. `npm test` fails on purpose.
- **Integration tests run serially.** Hosted Supabase rate-limits sign-up and sign-in. In parallel, suites die in `beforeAll` with `Request rate limit reached`, which reads like a failure and is not one. Before calling an integration red a real red, re-run it serially and say which it was.
- **A run that dies in setup leaks its users.** `afterAll` does not run when `beforeAll` throws. After any red integration run, say whether a sweep is needed.
- Test users use the reserved `squid-ink.test` domain. **Integration test emails start with `it-`.** Demo users (`guest-`, `team-`, `demo-`) and dev-login users (`dev-`) share the domain, so never sweep the whole domain. Select first, read the list, then delete:

  ```sql
  select email from auth.users where email like 'it-%@squid-ink.test';
  delete from auth.users where email like 'it-%@squid-ink.test';
  ```
- There are no integration suites yet; the database proofs are `scripts/verify-*.mjs`. These rules apply to the first suite that lands.
- **A reaper or sweep that deletes across the project lives in ONE test file.** Files run in parallel; two files sweeping delete each other's fixtures.

## Proving RLS

`node scripts/verify-rls.mjs` after any change to a policy, a grant, or a `user_id` column. Two real users run the identical query; the second must get a genuine empty result, not `permission denied`. That proves the database, **not** the cookie plumbing — that needs a request through `proxy.ts` with a real session. Run both.

## Proof scripts

    node scripts/verify-rls.mjs                    # two-user RLS proof, .env.local
    node scripts/verify-demo-rls.mjs               # demo read rule, door and cleanup; .env.local + SUPABASE_ACCESS_TOKEN
    node scripts/load-demo-owner.mjs               # (re)loads the demo notes, .env.local
    node scripts/verify-persona-provisioning.mjs   # signup-trigger proof, .env.local
    node scripts/verify-transcription-pipeline.mjs # live, needs `npm run dev`
    node scripts/verify-depth-and-fallback.mjs     # live notegen at Brief, Exhaustive and fallback; .env.local, no dev server
    node scripts/verify-embeddings-pipeline.mjs    # live, .env.local (VOYAGE_API_KEY); paces itself, minutes
    node scripts/verify-layout.mjs                 # layout proof, needs `npm run dev` and .env.local
    node scripts/verify-email-templates.mjs        # hosted auth email templates vs repo; SUPABASE_ACCESS_TOKEN

# Demo visitors read one shared demo owner's notes

Status: accepted (2026-09-26, issue #19)

Demo mode shows three demo notes held by one **demo owner** account. Every demo visitor reads those rows through a read policy that is wider than the standard `(select auth.uid()) = user_id`: an anonymous session may also read rows whose `user_id` is the demo owner. This is deliberate, not a hole. The widening is read-only, applies to anonymous sessions only, names exactly one account, and every write policy still carries `not public.is_anon_session()`, so no visitor can change the demo notes.

A visitor still gets their own anonymous identity, created only when they press the demo button on the landing page, never on a GET, so link previews and crawlers create nothing. That identity owns only the visitor's chat, which the per-visitor chat cap counts and which keeps visitors from seeing each other's questions. Anonymous identities are deleted after 7 days, taking their chat with them.

## Considered options

- **A copy of the demo notes per visitor.** Rejected. It needed no policy change, and the fixture in `lib/demo/` was first authored for it, but each copy carries about 180 embedded chunks, roughly 1.5–2 MB per visit (estimated, not measured). A few hundred visits, or one person or bot pressing the button repeatedly, would fill the database with identical rows.
- **Entering the demo from a plain `/demo` link**, as the TEKGUYZ CRM does. Rejected. A GET that creates an identity is followed by link previews, prefetch and crawlers, and the CRM needed two guards to stop it replacing a real session. A shared link opens the landing page instead, and the button there is the only door.

## Consequences

- `scripts/verify-rls.mjs` must prove the owner's real notes stay invisible to an anonymous session, and that a signed-in real account does not gain the demo owner's rows.
- `chat_messages.note_id` is a single-column foreign key, so a visitor's chat row can reference a demo note. The chat route's note-ownership check must accept "demo owner's note, anonymous session" and nothing wider.
- The new-account persona trigger also fires for anonymous identities; visitors read the demo owner's personas instead, so the trigger should skip them.

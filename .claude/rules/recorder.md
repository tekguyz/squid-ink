---
paths:
  - "lib/recorder/**"
  - "components/recorder/**"
  - "app/notes/actions/recording.ts"
  - "scripts/verify-recorder-upload.mjs"
---

# Recorder

The HUD is mounted once in `app/layout.tsx` and the Zustand store in
`lib/recorder/recorder-store.ts` lives at **module scope**. Neither may move
into a route or a provider — a store that resets on navigation defeats the
whole "ambient, not calendar-gated" decision. There is a test asserting that
importing the module twice yields the same state.

`getDisplayMedia` is called with `video: true` even though nothing records
video. Chromium does not offer tab or system audio for an audio-only display
request — the audio checkbox is simply not shown. The video track is stopped on
arrival.

`MediaRecorder` records the Web Audio destination node's stream, never the mic
stream. That indirection is what lets `replaceMic()` swap a microphone
mid-recording without ending the recording.

The mic constraint is exactly `{ echoCancellation: true }`. That is the
baseline `docs/ROADMAP.md` §8b names for the no-headphones echo case, and it is
the default.

`noiseSuppression` is **not forbidden.** ROADMAP §7 and `docs/DECISIONS.md`
§ Rejected both reject *custom edge-ML* noise masking, on cost grounds, and both
name browser `noiseSuppression: true` as the free equivalent to reach for **if
audio quality — not cost — ever becomes a measured problem.** Enable it for that
reason, with the measurement that prompted it. Do not enable it speculatively.

`autoGainControl` has no decision behind it in either direction. Leave it off
until one exists.

**Corrected 2026-08-31.** This paragraph read "Do not add `noiseSuppression` or
`autoGainControl` — ROADMAP §7 rejected extra masking", citing §7 for the
opposite of what §7 says. It survived because §7 was not in the tree and could
not be opened.

The Storage path is `{user_id}/{note_id}`: two segments, that order, no
extension. It is not a naming convention — it is what the three policies in
`storage_audio.sql` check. **Never confirm an upload with `download()`**;
Storage reads are CDN-cached and return the pre-overwrite body. Use the upload
response or `list()` metadata.

The notes row is written when the upload **starts**, at
`processing_status = 'uploading'`, because the path is deterministic. This track
never writes `'analyzing'` or `'completed'` — those are Track 3's. A failed
upload writes `'failed'` in-session through `markUploadFailed()` — tier 1,
shipped 2026-09-01 — and still leaves its audio in IndexedDB; **nothing
reconciles that pair**, so Track 3 must check the object exists before
transcribing.

**Corrected 2026-09-01.** This paragraph read "leaves a visible row … nothing
reconciles that pair yet", written when tier 1 did not exist. The row half is
now reconciled in milliseconds; the blob half is not.

Codec strings are feature-detected through `lib/recorder/codec.ts`. Never
hardcode one, and keep WebM ahead of MP4 — Chromium accepts both, so the order
decides what Chromium produces.

Deleting a test recording needs two clients: the **row** as the owner, the
**object** as the admin (storage ships no DELETE policy, and `service_role`
bypasses RLS). `scripts/verify-recorder-upload.mjs` does both correctly.

The reason for the row half changed on 2026-08-31 and the practice did not.
`service_role` used to hold **no grant at all** on `public.notes`, so an admin
delete failed outright; it now holds `select, insert, update, delete` for the
transcription cron. Deleting as the owner is still right, because it exercises
the RLS path a real user takes — but it is now a deliberate choice rather than
the only option, and a script that deletes as the admin will silently succeed
while proving nothing about RLS.

    node scripts/verify-recorder-upload.mjs   # live upload + note row proof
    node scripts/print-signin-link.mjs        # local sign-in link, magic-link only

Device handoff, real-world echo and Safari cannot be tested here. They have a
runnable checklist: `docs/qa/recorder-manual-test-protocol.md`. Check the
**bitrate** of every manual recording — a muted mic yields ~2 kbit/s and
otherwise looks like a complete success.

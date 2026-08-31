# Recorder — Manual Test Protocol

Three things this app has to get right cannot be proved by `npm test` or by any
script in `scripts/`: swapping headphones mid-recording, echo with no
headphones, and Safari. This is the checklist that covers them.

Run the whole thing after any change to `lib/recorder/` or
`components/recorder/`. Budget about 25 minutes.

Record the browser name and full version for every section you run. A pass on
Chrome 148 says nothing about Safari 18.

---

## Before you start

1. Start the dev server and sign in:

```bash
node scripts/print-signin-link.mjs http://localhost:3000
```

   Open the printed URL. You should land on `/`, signed in, with the **Record**
   pill docked bottom-right. Login is magic-link only, so this script is the
   only way to get a fresh unspent link locally.

2. Have ready: headphones with a microphone, and a browser tab that plays sound
   (any video with speech).

3. **Know what a healthy recording looks like.** These are measured from real
   runs on Chrome 148 / Windows 11, not estimates. Every size below is
   `audio/webm` with Opus:

   | Condition | Duration | Size | Bitrate |
   |---|---|---|---|
   | Mic muted, silent tab | 29 s | 7,441 B | **2.1 kbit/s** |
   | Mic live, speech only | 26 s | 98,963 B | **30.5 kbit/s** |
   | Mic live + tab audio playing | 43 s | 700,869 B | **130 kbit/s** |

   **A recording near 2 kbit/s means no audio reached the encoder.** Opus
   compresses near-silence that hard, so a muted mic and a silent tab produce a
   file that looks successful and contains nothing. Check the bitrate on every
   run — a green HUD is not proof that audio was captured. This is the single
   easiest failure to miss.

---

## Section A — Device handoff mid-recording

**Why:** ROADMAP §8b calls this "a common real scenario, not an edge case."
Someone puts headphones on halfway through a meeting; the recording must
continue, not die.

| # | Do this | Expect |
|---|---|---|
| A1 | Play audio in another tab. Click **Record**. | Two prompts: the screen/tab picker, then the microphone. |
| A2 | In the picker, choose the tab that is playing audio and make sure **"Also share tab audio"** is ON. | It defaults to on. Capture starts. |
| A3 | Allow the microphone. **Check your mic is not muted in the OS.** | The HUD switches to the recording pill. |
| A4 | Watch the HUD for 10 seconds while speaking. | The clock counts up. The level bars move **when you speak**, not when only the tab plays — the meter is wired to the mic branch, not the mix. |
| A5 | With the recording still running, **plug in headphones with a mic** (or connect Bluetooth ones). | The clock **does not reset** and **does not stop**. The pill stays in its recording state. |
| A6 | Speak again for 10 seconds. | The level bars move again. A sub-second dropout at the moment of the swap is expected and acceptable. |
| A7 | **Unplug the headphones.** | Same as A5: recording continues, clock keeps counting. |
| A8 | Speak for 10 more seconds, then click **Stop**. | The pill shows "Uploading", then returns to the **Record** idle pill. |
| A9 | Go to `/`. | A new note is in the list, titled "Untitled". |
| A10 | Check the bitrate — see "Checking a recording" below. | Should be in the 25–130 kbit/s band. **If it is near 2 kbit/s the handoff silently killed the audio**, even though every visible step passed. |
| A11 | Open the note. | It opens without error. **No transcript** — that is Track 3 and is correct here. |

**Fail conditions:** the recording ends at A5 or A7; the clock resets; the level
bars stay dead after A6; the HUD lands in the error state; A10 shows ~2 kbit/s.

---

## Section B — Echo with no headphones

**Why:** the only echo control this app has is the `echoCancellation: true` mic
constraint. ROADMAP §7 and DECISIONS.md explicitly rejected adding anything on
top of it. This section checks the baseline is doing its job — it is **not** a
prompt to add more masking.

| # | Do this | Expect |
|---|---|---|
| B1 | **Take headphones off.** Use laptop speakers and the built-in mic. | — |
| B2 | Play a video with clear speech in another tab, at normal listening volume. | — |
| B3 | Click **Record**, share that tab **with audio**, allow the mic. | Recording starts. |
| B4 | Stay silent for 20 seconds while the video plays. | Level bars stay low. Some movement is normal — the mic does hear the speakers. |
| B5 | Talk over the video for 20 seconds. | Level bars clearly rise above the B4 level. |
| B6 | **Stop.** Note the note id from the URL after opening it from `/`. | Upload completes. |
| B7 | Pull the file and listen — see "Checking a recording". | Your voice is clearly audible. The tab audio is audible. **You do not hear a doubled or slapback copy of the tab audio** — one clean pass through, not two offset ones. |

**Fail condition:** B7 has an obvious slapback echo of the tab audio. If it
does, the finding is "echoCancellation is not being applied" — check the
constraint in `lib/recorder/capture.ts` is exactly `{ echoCancellation: true }`
and that the mic is a real device, not a virtual loopback.

**Do not "fix" this by adding noise suppression or custom masking.** That is a
locked decision (ROADMAP §7), not an oversight.

---

## Section C — Safari

**Why:** Safari supports no WebM at all. `lib/recorder/codec.ts` lists
`audio/mp4;codecs=mp4a.40.2` and `audio/mp4` for it. Those strings were
implemented from the spec and are **unverified until this section is run.**

For contrast, here is the real Chromium result, run on Chrome 148 / Windows 11:

```
audio/webm;codecs=opus      ->  true      <- selected
audio/webm                  ->  true
audio/mp4;codecs=mp4a.40.2  ->  true
audio/mp4                   ->  true
audio/ogg;codecs=opus       ->  false
```

Note Chromium accepts the MP4 strings too. The WebM-first ordering in
`CODEC_CANDIDATES` is therefore load-bearing, not decorative — reorder it and
Chromium starts producing MP4.

| # | Do this | Expect |
|---|---|---|
| C1 | Open the app in Safari. Sign in with a fresh link from `print-signin-link.mjs`. | The **Record** pill appears. |
| C2 | In Safari's Web Inspector console, run the snippet below. | Record the exact output. At least one `audio/mp4` entry should be `true`. Every `audio/webm` entry is expected to be `false`. |
| C3 | If **every** entry is `false`. | The HUD should show "This browser cannot record audio." rather than crashing. That is `pickMimeType` returning null, handled. |
| C4 | Click **Record**. | Safari prompts for screen/tab sharing, then the mic. **Safari's picker may not offer tab audio at all** — if so, record that fact; it is a Safari platform limit, not a bug in this code. |
| C5 | Record 15 seconds of speech, then **Stop**. | Upload completes, the HUD returns to idle. |
| C6 | Go to `/`. | The new note is listed. |
| C7 | Check the container — see "Checking a recording". | The file is MP4/AAC audio, not WebM, and `notes.audio_storage_path`'s object has `mimetype` starting `audio/mp4`. |
| C8 | Press **⌘⇧R** with the HUD idle. | A recording starts. **The page must not reload.** ⌘⇧R / Ctrl+Shift+R is also the browser's hard-reload shortcut; the HUD calls `preventDefault()` to claim it. Verified working on Chrome 148 / Windows with a real keypress (`isTrusted: true`, no reload) — **unverified on macOS, Safari and Firefox.** If the page reloads instead, the browser reserved the combo and the `⌘⇧R` label in the idle pill is lying; report it rather than removing the handler, since the shortcut is the design's choice. |

C2 snippet:

```js
["audio/webm;codecs=opus","audio/webm","audio/mp4;codecs=mp4a.40.2","audio/mp4","audio/ogg;codecs=opus"].map(t => t + "  ->  " + MediaRecorder.isTypeSupported(t))
```

**Record for the report:** Safari version, the full C2 output, whether C4
offered tab audio, and the container from C7.

---

## Section D — The local backup buffer

**Why:** ROADMAP §8b, light version. The blob must survive navigation and must
not be discarded before `processing_status` reaches `completed`.

| # | Do this | Expect |
|---|---|---|
| D1 | Start a recording. While it runs, click through to a different route and back. | The HUD keeps counting. The clock does not reset. |
| D2 | **Stop.** Wait for the idle pill. | Upload completes. |
| D3 | DevTools → Application → IndexedDB → `recorder-backup` → `recordings`. | **A row is still there** for the note you just made. It holds `bytes` (an ArrayBuffer), not a Blob — that is deliberate. |
| D4 | Reload the page. Look again. | The row is still there. |

**This is correct, not a leak.** Track 3 does not exist, so no note reaches
`completed`, so nothing is ever discarded. When Track 3 ships, D3 becomes "the
row is gone once the note reads `completed`."

---

## Section E — Failed upload

**Why:** the row is written *before* the bytes move, so a failure is visible
rather than silent. This section confirms that, and confirms what it leaves
behind.

| # | Do this | Expect |
|---|---|---|
| E1 | Start a recording. Let it run 15 seconds. | — |
| E2 | DevTools → Network → **Offline**. Click **Stop**. | The HUD shows an error pill: the message, "The recording is kept on this device.", and **Dismiss**. |
| E3 | Confirm there is **no retry button**. | Correct. Retry is deliberately out of scope — the requirement is that the failure be visible, not one-click recoverable. |
| E4 | Check IndexedDB as in D3. | The blob is there. |
| E5 | Network back to **Online**. Go to `/`. | **A note IS in the list.** The row is written as the upload starts, so it exists even though the upload failed. Intended. |
| E6 | Check the row's status and path (see below). | `uploading`, with an `audio_storage_path` pointing at an object **that is not there**. |
| E7 | Confirm the object is absent using `list()`, **not** `download()`. | Empty listing for that note id under your user prefix. |

**Do not file E5/E6 as a bug.** A row at `uploading` with a missing object is
the designed failure state: the note stays visible and the audio stays
recoverable.

**Do file this if it bothers you:** nothing reconciles that pair. There is no
retry, no sweeper, no expiry. The row stays at `uploading` forever and the blob
is never freed. See `docs/KNOWN_GAPS.md`.

---

## Checking a recording

There is no playback UI yet. Find the path and size first:

```bash
npx supabase db query --linked --project-ref pbwvvakzbrimmdntqxxn "select n.id, n.audio_duration_seconds, (o.metadata->>'size')::bigint as size_bytes, o.metadata->>'mimetype' as mimetype, o.name from public.notes n join storage.objects o on o.name = n.audio_storage_path and o.bucket_id = 'audio-recordings' order by n.created_at desc limit 5;"
```

Divide `size_bytes * 8 / audio_duration_seconds` for the bitrate and compare
against the table at the top. **Do this before you bother downloading anything**
— it catches the silent-capture failure in one step.

To actually listen, pull the object with the secret key. There is no DELETE
policy, so the secret key is also the only way to remove test objects:

```bash
node -e "const{readFileSync,writeFileSync}=require('fs');const e=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));const{createClient}=require('@supabase/supabase-js');createClient(e.NEXT_PUBLIC_SUPABASE_URL,e.SUPABASE_SECRET_KEY).storage.from('audio-recordings').download(process.argv[1]).then(async r=>{if(r.error)throw r.error;writeFileSync('recording.webm',Buffer.from(await r.data.arrayBuffer()));console.log('wrote recording.webm')})" "<user_id>/<note_id>"
```

```bash
ffprobe recording.webm
```

`recording.webm`, `*.bin` and `*.m4a` are gitignored. Delete the file when you
are done anyway — it is somebody's meeting.

**Never use `download()` to confirm an upload just happened.** Storage serves
reads through a caching CDN and returns the pre-overwrite body straight after an
upsert. Confirm uploads with `list()` metadata, as the query above does.

---

## Cleaning up test recordings

Test runs leave notes stuck at `uploading` forever, because nothing advances
them. To remove one, delete the row **as the owner** and the object **as the
admin** — the two need different clients, for real reasons:

- `notes.sql` grants `public.notes` to `authenticated` only. The secret key is
  `service_role` and gets `permission denied for table notes`.
- `storage_audio.sql` ships **no DELETE policy**, so no authenticated user can
  remove an object. Only the secret key can.

`scripts/verify-recorder-upload.mjs` does both correctly in its `finally` block
— copy the pattern from there rather than reinventing it.

---

## Reporting a run

Paste into the PR or the track report:

- Browser names and full versions for every section run.
- The exact `isTypeSupported` output from C2, and its Chromium equivalent.
- **The duration/size/bitrate for every recording made.** A section that passed
  visually but produced a 2 kbit/s file did not pass.
- Which sections passed, which failed, which were **not run** and why.
- Any section skipped because hardware was unavailable — say so. A skipped
  section is not a passed one.

/**
 * The recording mode (CONTEXT.md): what a recording captures, chosen by the
 * user before it starts. A cancelled or refused prompt never chooses it.
 *
 * - `meeting` — the shared tab's or system's sound plus the microphone.
 * - `mic` — the microphone alone. The only mode on a device that cannot share
 *   sound (Android, iOS), where it starts without asking.
 *
 * Not saved on the note (#20): no column, no migration.
 */
export type RecordingMode = "meeting" | "mic";

/** Shown on the choice after a Meeting share came back with no audio track:
 *  the "Share audio" box was unticked, or the browser (Firefox, desktop
 *  Safari) shares no sound at all. */
export const NO_SOUND_SHARED =
  "No sound was shared. Turn on tab audio in the picker, or choose Mic only. Some browsers cannot share sound at all.";

/** Shown when the microphone prompt is refused. Plain words, never the raw
 *  DOMException text. */
export const MIC_REFUSED =
  "Squid Ink needs your microphone to record. Allow it in the browser’s site settings, then try again.";

/** What each mode records, in the fewest words. Shown beside the choice and
 *  read as each option's description, so sight and screen reader get the
 *  same words. */
export const MODE_DESCRIPTION: Record<RecordingMode, string> = {
  meeting: "Tab sound + your mic",
  mic: "Your mic alone",
};

/** The recording pill's screen-reader line, per mode actually recorded. */
export const RECORDING_ANNOUNCEMENT: Record<RecordingMode, string> = {
  meeting: "Recording shared sound and microphone",
  mic: "Recording microphone",
};

/** The waiting pill (#24): what the browser's prompt needs from the user while
 *  the HUD waits on it. Meeting opens the share picker; Mic only, the mic
 *  prompt. */
export const WAITING_PROMPT: Record<RecordingMode, string> = {
  meeting: "Choose a tab to share",
  mic: "Allow your microphone",
};

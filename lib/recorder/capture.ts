/**
 * Records one of two recording modes (lib/recorder/recording-mode.ts), always
 * through one Web Audio destination stream for one MediaRecorder:
 *
 * - Meeting: shared tab or system sound, plus the microphone.
 * - Mic only: the microphone alone. getDisplayMedia is never called.
 *
 * System audio is not mandatory any more (#20). A device that cannot share
 * sound records Mic only, and a Meeting whose share carries no sound comes
 * back as "no-sound" instead of a crash, so the user can pick again.
 *
 * Every expected outcome of a prompt is a value, not a throw: "cancelled"
 * (the share picker was dismissed), "no-sound" (a share with no audio track),
 * "mic-refused" (the microphone prompt was refused). Only the unexpected
 * throws. The hook maps each value to what the user sees.
 *
 * Two rules are encoded here that are not obvious from the API surface:
 *
 * 1. getDisplayMedia is asked for `video: true` even though this feature
 *    records no video. Chromium does not offer tab or system audio for an
 *    audio-only display request — the audio checkbox simply is not shown. The
 *    video track is stopped the moment it arrives. It is a permission-dialog
 *    tax, not something we keep.
 *
 * 2. MediaRecorder is handed the destination node's stream, never the mic
 *    stream. Everything downstream depends on that indirection: replaceMic()
 *    can disconnect the old mic source and wire a new one to the same gain
 *    node, and the recorder's stream object never changes, so a mic swapped
 *    mid-meeting does not end the recording. The same indirection is why a
 *    Meeting survives "Stop sharing": the share branch goes quiet and the mic
 *    branch carries on into the same stream.
 *
 * The mic constraint is exactly { echoCancellation: true } — the baseline
 * ROADMAP §8b names for the no-headphones echo case.
 *
 * noiseSuppression is deliberately absent, NOT prohibited. ROADMAP §7 and
 * DECISIONS.md § Rejected both reject custom edge-ML noise masking on cost
 * grounds, and both name browser noiseSuppression: true as the free equivalent
 * to reach for if audio QUALITY, not cost, becomes a measured problem. Adding
 * it needs that measurement, not a hunch. autoGainControl has no decision
 * behind it either way and stays off until one exists.
 *
 * Corrected 2026-08-31: this comment used to cite "ROADMAP §7 rejected extra
 * masking" as forbidding both, which is the opposite of what §7 says.
 */
import type { RecordingMode } from "@/lib/recorder/recording-mode";

export interface CaptureDeps {
  getDisplayMedia(constraints: DisplayMediaStreamOptions): Promise<MediaStream>;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createAudioContext(): AudioContext;
}

export interface CaptureHandles {
  /** The MIXED stream. This is what MediaRecorder records. */
  stream: MediaStream;
  analyser: AnalyserNode;
  micDeviceId(): string | undefined;
  replaceMic(): Promise<void>;
  stop(): void;
}

export type CaptureOutcome =
  | { kind: "started"; handles: CaptureHandles }
  | { kind: "cancelled" }
  | { kind: "no-sound" }
  | { kind: "mic-refused" };

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true },
};

function browserDeps(): CaptureDeps {
  return {
    getDisplayMedia: (c) => navigator.mediaDevices.getDisplayMedia(c),
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    createAudioContext: () => new AudioContext(),
  };
}

function stopAll(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** What a browser prompt rejects with when the user dismisses or refuses it.
 *  Chromium, Firefox and Safari all use NotAllowedError for both. */
function isRefusal(error: unknown) {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

export async function startCapture(
  mode: RecordingMode,
  overrides: Partial<CaptureDeps> = {},
): Promise<CaptureOutcome> {
  const deps = { ...browserDeps(), ...overrides };

  // The shared tab first: its picker is the one the user is most likely to
  // cancel, and failing before the mic prompt means one fewer dialog to
  // dismiss on the way out. Mic only never opens it.
  let systemStream: MediaStream | null = null;
  if (mode === "meeting") {
    try {
      systemStream = await deps.getDisplayMedia({ audio: true, video: true });
    } catch (error) {
      if (isRefusal(error)) return { kind: "cancelled" };
      throw error;
    }
    for (const track of systemStream.getVideoTracks()) track.stop();
    if (systemStream.getAudioTracks().length === 0) {
      stopAll(systemStream);
      return { kind: "no-sound" };
    }
  }

  let micStream: MediaStream;
  try {
    micStream = await deps.getUserMedia(MIC_CONSTRAINTS);
  } catch (error) {
    // Do not leave the screen-share indicator running because the second
    // prompt was refused.
    stopAll(systemStream);
    if (isRefusal(error)) return { kind: "mic-refused" };
    throw error;
  }

  const context = deps.createAudioContext();
  const destination = context.createMediaStreamDestination();

  const micGain = context.createGain();
  micGain.connect(destination);

  if (systemStream) {
    const systemGain = context.createGain();
    systemGain.connect(destination);
    const systemSource = context.createMediaStreamSource(systemStream);
    systemSource.connect(systemGain);
    // "Stop sharing" ends the shared track. The recording carries on with the
    // mic branch alone; unhooking the dead source is tidiness, not rescue.
    systemStream
      .getAudioTracks()[0]
      .addEventListener("ended", () => systemSource.disconnect());
  }

  // The meter answers "is my microphone working", so it hangs off the mic
  // branch rather than the mix — system audio alone must not make it look live.
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  micGain.connect(analyser);

  let micSource = context.createMediaStreamSource(micStream);
  micSource.connect(micGain);

  const currentMicId = () => micStream.getAudioTracks()[0]?.getSettings().deviceId;

  const handles: CaptureHandles = {
    stream: destination.stream,
    analyser,
    micDeviceId: currentMicId,

    async replaceMic() {
      const next = await deps.getUserMedia(MIC_CONSTRAINTS);
      micSource.disconnect();
      stopAll(micStream);
      micStream = next;
      micSource = context.createMediaStreamSource(micStream);
      micSource.connect(micGain);
    },

    stop() {
      stopAll(micStream);
      stopAll(systemStream);
      void context.close();
    },
  };
  return { kind: "started", handles };
}

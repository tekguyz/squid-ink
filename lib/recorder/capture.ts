/**
 * System audio + microphone, mixed into one stream for one MediaRecorder.
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
 *    mid-meeting does not end the recording.
 *
 * The mic constraint is exactly { echoCancellation: true }. No noiseSuppression
 * and no autoGainControl — ROADMAP §7 rejected extra masking, and adding
 * constraints "while we are here" is how a locked decision quietly rots.
 */
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

function stopAll(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

export async function startCapture(
  overrides: Partial<CaptureDeps> = {},
): Promise<CaptureHandles> {
  const deps = { ...browserDeps(), ...overrides };

  // System audio first: its picker is the one the user is most likely to
  // cancel, and failing before the mic prompt means one fewer dialog to
  // dismiss on the way out.
  const systemStream = await deps.getDisplayMedia({ audio: true, video: true });
  for (const track of systemStream.getVideoTracks()) track.stop();

  let micStream: MediaStream;
  try {
    micStream = await deps.getUserMedia(MIC_CONSTRAINTS);
  } catch (error) {
    // Do not leave the screen-share indicator running because the second
    // prompt was refused.
    stopAll(systemStream);
    throw error;
  }

  const context = deps.createAudioContext();
  const destination = context.createMediaStreamDestination();

  const micGain = context.createGain();
  micGain.connect(destination);

  const systemGain = context.createGain();
  systemGain.connect(destination);
  context.createMediaStreamSource(systemStream).connect(systemGain);

  // The meter answers "is my microphone working", so it hangs off the mic
  // branch rather than the mix — system audio alone must not make it look live.
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  micGain.connect(analyser);

  let micSource = context.createMediaStreamSource(micStream);
  micSource.connect(micGain);

  const currentMicId = () => micStream.getAudioTracks()[0]?.getSettings().deviceId;

  return {
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
}

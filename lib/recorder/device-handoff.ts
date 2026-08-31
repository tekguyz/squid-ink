/**
 * Watches for the microphone being pulled out from under a live recording.
 *
 * Headphones going on or coming off mid-meeting is ordinary, not an edge case
 * (ROADMAP §8b). The browser does not tell you WHICH device went away — it
 * fires a bare `devicechange` — so the check is: enumerate again, and see
 * whether the id we are recording from is still in the list.
 *
 * Detection only. The repair (re-acquire and splice into the running Web Audio
 * graph) belongs to capture.ts, because that is where the graph lives.
 *
 * `mediaDevices` is a parameter so this is testable without hardware, and
 * `currentDeviceId` is a getter rather than a value so a mic replaced during
 * the recording is tracked from then on instead of the watcher firing forever
 * against a stale id.
 */
export interface MediaDevicesLike {
  addEventListener(type: "devicechange", listener: () => void): void;
  removeEventListener(type: "devicechange", listener: () => void): void;
  enumerateDevices(): Promise<Pick<MediaDeviceInfo, "kind" | "deviceId">[]>;
}

export function watchAudioInputs(options: {
  mediaDevices: MediaDevicesLike;
  currentDeviceId: () => string | undefined;
  onDeviceLost: () => void;
}): () => void {
  const { mediaDevices, currentDeviceId, onDeviceLost } = options;

  const listener = () => {
    void (async () => {
      const wanted = currentDeviceId();
      // No id means we never learned which mic this is. Firing here would
      // restart the capture on every unrelated device change, which is worse
      // than doing nothing.
      if (!wanted) return;

      const devices = await mediaDevices.enumerateDevices();
      const stillThere = devices.some(
        (d) => d.kind === "audioinput" && d.deviceId === wanted,
      );
      if (!stillThere) onDeviceLost();
    })();
  };

  mediaDevices.addEventListener("devicechange", listener);
  return () => mediaDevices.removeEventListener("devicechange", listener);
}

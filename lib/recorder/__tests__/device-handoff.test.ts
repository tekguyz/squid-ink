import { describe, expect, it, vi } from "vitest";
import { watchAudioInputs, type MediaDevicesLike } from "@/lib/recorder/device-handoff";

type Device = { kind: string; deviceId: string };

/** A stand-in for navigator.mediaDevices with a hand-fired devicechange. */
function fakeMediaDevices(initial: Device[]) {
  let devices = initial;
  const listeners = new Set<() => void>();

  return {
    addEventListener: (_t: "devicechange", l: () => void) => void listeners.add(l),
    removeEventListener: (_t: "devicechange", l: () => void) => void listeners.delete(l),
    enumerateDevices: async () => devices as never,
    set(next: Device[]) {
      devices = next;
    },
    listenerCount: () => listeners.size,
    async fire() {
      for (const l of listeners) l();
      // let the listener's own await enumerateDevices() settle
      await Promise.resolve();
      await Promise.resolve();
    },
  } satisfies MediaDevicesLike & Record<string, unknown>;
}

const MIC = { kind: "audioinput", deviceId: "mic-a" };
const OTHER_MIC = { kind: "audioinput", deviceId: "mic-b" };
const SPEAKER = { kind: "audiooutput", deviceId: "spk-a" };

describe("watchAudioInputs", () => {
  it("subscribes to devicechange", () => {
    const md = fakeMediaDevices([MIC]);
    watchAudioInputs({
      mediaDevices: md,
      currentDeviceId: () => "mic-a",
      onDeviceLost: vi.fn(),
    });
    expect(md.listenerCount()).toBe(1);
  });

  it("stays quiet when the current mic is still present", async () => {
    const md = fakeMediaDevices([MIC, OTHER_MIC]);
    const onDeviceLost = vi.fn();
    watchAudioInputs({ mediaDevices: md, currentDeviceId: () => "mic-a", onDeviceLost });
    await md.fire();
    expect(onDeviceLost).not.toHaveBeenCalled();
  });

  it("reports the loss when the current mic disappears", async () => {
    const md = fakeMediaDevices([MIC, OTHER_MIC]);
    const onDeviceLost = vi.fn();
    watchAudioInputs({ mediaDevices: md, currentDeviceId: () => "mic-a", onDeviceLost });
    md.set([OTHER_MIC]);
    await md.fire();
    expect(onDeviceLost).toHaveBeenCalledTimes(1);
  });

  it("ignores output devices — unplugging a speaker is not losing a mic", async () => {
    const md = fakeMediaDevices([MIC, SPEAKER]);
    const onDeviceLost = vi.fn();
    watchAudioInputs({ mediaDevices: md, currentDeviceId: () => "mic-a", onDeviceLost });
    md.set([MIC]);
    await md.fire();
    expect(onDeviceLost).not.toHaveBeenCalled();
  });

  it("stays quiet when the current device id is unknown, rather than firing on every change", async () => {
    const md = fakeMediaDevices([MIC]);
    const onDeviceLost = vi.fn();
    watchAudioInputs({
      mediaDevices: md,
      currentDeviceId: () => undefined,
      onDeviceLost,
    });
    md.set([]);
    await md.fire();
    expect(onDeviceLost).not.toHaveBeenCalled();
  });

  it("re-reads the current device id on every event, so a repaired mic is tracked", async () => {
    const md = fakeMediaDevices([MIC, OTHER_MIC]);
    const onDeviceLost = vi.fn();
    let current = "mic-a";
    watchAudioInputs({ mediaDevices: md, currentDeviceId: () => current, onDeviceLost });

    md.set([OTHER_MIC]);
    await md.fire();
    expect(onDeviceLost).toHaveBeenCalledTimes(1);

    current = "mic-b";
    await md.fire();
    expect(onDeviceLost).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes when the returned function is called", () => {
    const md = fakeMediaDevices([MIC]);
    const stop = watchAudioInputs({
      mediaDevices: md,
      currentDeviceId: () => "mic-a",
      onDeviceLost: vi.fn(),
    });
    stop();
    expect(md.listenerCount()).toBe(0);
  });
});

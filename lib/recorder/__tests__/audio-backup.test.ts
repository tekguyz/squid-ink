import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  discardBackup,
  listBackups,
  loadBackup,
  saveBackup,
} from "@/lib/recorder/audio-backup";

const NOTE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER = "11111111-2222-3333-4444-555555555555";

const record = (noteId: string, text = "audio bytes") => ({
  noteId,
  blob: new Blob([text], { type: "audio/webm" }),
  mimeType: "audio/webm;codecs=opus",
  durationSeconds: 42,
  savedAtMs: 1_700_000_000_000,
});

describe("audio backup buffer", () => {
  beforeEach(async () => {
    for (const existing of await listBackups()) {
      await discardBackup(existing.noteId);
    }
  });

  it("returns null for a note it has never seen", async () => {
    expect(await loadBackup(NOTE)).toBeNull();
  });

  it("stores a blob and reads back the same bytes", async () => {
    await saveBackup(record(NOTE));
    const found = await loadBackup(NOTE);
    expect(found).not.toBeNull();
    expect(await found!.blob.text()).toBe("audio bytes");
    expect(found!.mimeType).toBe("audio/webm;codecs=opus");
    expect(found!.durationSeconds).toBe(42);
  });

  it("survives a fresh module instance, which is what surviving navigation means", async () => {
    await saveBackup(record(NOTE));
    vi.resetModules();
    const reimported = await import("@/lib/recorder/audio-backup");
    const found = await reimported.loadBackup(NOTE);
    expect(await found!.blob.text()).toBe("audio bytes");
  });

  it("keys by note id, so two recordings do not collide", async () => {
    await saveBackup(record(NOTE, "first"));
    await saveBackup(record(OTHER, "second"));
    expect(await (await loadBackup(NOTE))!.blob.text()).toBe("first");
    expect(await (await loadBackup(OTHER))!.blob.text()).toBe("second");
    expect((await listBackups()).length).toBe(2);
  });

  it("replaces in place when the same note is saved twice", async () => {
    await saveBackup(record(NOTE, "first"));
    await saveBackup(record(NOTE, "retake"));
    expect((await listBackups()).length).toBe(1);
    expect(await (await loadBackup(NOTE))!.blob.text()).toBe("retake");
  });

  it("discards only the note it is asked about", async () => {
    await saveBackup(record(NOTE));
    await saveBackup(record(OTHER));
    await discardBackup(NOTE);
    expect(await loadBackup(NOTE)).toBeNull();
    expect(await loadBackup(OTHER)).not.toBeNull();
  });

  it("discarding something absent is not an error", async () => {
    await expect(discardBackup("no-such-note")).resolves.toBeUndefined();
  });
});

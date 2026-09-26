import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  discardBackup,
  listBackups,
  loadBackup,
  saveBackup,
} from "@/lib/recorder/audio-backup";
import {
  FAILED_BACKUP_TTL_MS,
  backupsToDiscard,
  cleanUpBackups,
} from "@/lib/recorder/backup-cleanup";

const NOW = Date.UTC(2026, 8, 26, 12);
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const row = (noteId: string, status: string, ageMs = 0) => ({
  noteId,
  status,
  updatedAtMs: NOW - ageMs,
});

describe("backupsToDiscard", () => {
  it("discards a 'completed' note's backup at once", () => {
    expect(backupsToDiscard([row(A, "completed")], NOW)).toEqual([A]);
  });

  it("keeps a 'failed' backup younger than seven days — the user may still retry", () => {
    expect(backupsToDiscard([row(A, "failed", FAILED_BACKUP_TTL_MS - 1)], NOW)).toEqual([]);
  });

  it("discards a 'failed' backup once it is seven days old", () => {
    expect(backupsToDiscard([row(A, "failed", FAILED_BACKUP_TTL_MS)], NOW)).toEqual([A]);
  });

  it("never discards on 'uploading' or 'analyzing', however old", () => {
    const year = 365 * 24 * 60 * 60 * 1000;
    expect(
      backupsToDiscard([row(A, "uploading", year), row(B, "analyzing", year)], NOW),
    ).toEqual([]);
  });

  it("the seven days are seven days", () => {
    expect(FAILED_BACKUP_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

const save = (noteId: string) =>
  saveBackup({
    noteId,
    blob: new Blob(["audio"], { type: "audio/webm" }),
    mimeType: "audio/webm",
    durationSeconds: 1,
    savedAtMs: 0,
  });

describe("cleanUpBackups", () => {
  beforeEach(async () => {
    for (const existing of await listBackups()) await discardBackup(existing.noteId);
  });

  it("asks about every stored backup and discards only what the server names", async () => {
    await save(A);
    await save(B);
    await save(C);
    const safeToDiscard = vi.fn(async (_ids: string[]) => [B]);

    await cleanUpBackups(safeToDiscard);

    expect([...safeToDiscard.mock.calls[0][0]].sort()).toEqual([A, B, C]);
    expect(await loadBackup(A)).not.toBeNull();
    expect(await loadBackup(B)).toBeNull();
    expect(await loadBackup(C)).not.toBeNull();
  });

  it("makes no server call when there is nothing stored", async () => {
    const safeToDiscard = vi.fn(async (_ids: string[]) => []);
    await cleanUpBackups(safeToDiscard);
    expect(safeToDiscard).not.toHaveBeenCalled();
  });

  it("ignores an id the server returns that it never asked about", async () => {
    await save(A);
    await cleanUpBackups(async () => [C]);
    expect(await loadBackup(A)).not.toBeNull();
  });
});

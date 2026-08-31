"use client";

import { createClient } from "@/lib/supabase/client";
import { createRecordedNote } from "@/app/notes/actions";
import { startCapture } from "@/lib/recorder/capture";
import { AUDIO_BUCKET, type StorageBucketLike } from "@/lib/recorder/upload-audio";

/**
 * The real browser and network wiring behind useRecorder, kept separate from
 * the orchestration so the hook stays readable and under the line ceiling.
 *
 * Every one of these is injectable because jsdom has none of them: no
 * MediaRecorder, no getDisplayMedia, no Web Audio, no crypto.randomUUID in
 * older runtimes. The tests pass fakes; nothing here runs under test.
 */
export interface RecorderDeps {
  capture: typeof startCapture;
  createRecorder(stream: MediaStream, mimeType: string): MediaRecorder;
  isTypeSupported(type: string): boolean;
  newNoteId(): string;
  now(): number;
  getUserId(): Promise<string>;
  bucket(): StorageBucketLike;
  createNote: typeof createRecordedNote;
}

export function browserDeps(): RecorderDeps {
  return {
    capture: startCapture,
    createRecorder: (stream, mimeType) => new MediaRecorder(stream, { mimeType }),
    isTypeSupported: (type) => MediaRecorder.isTypeSupported(type),
    newNoteId: () => crypto.randomUUID(),
    now: () => performance.now(),
    getUserId: async () => {
      const { data } = await createClient().auth.getUser();
      if (!data.user) throw new Error("Cannot record: not signed in.");
      return data.user.id;
    },
    bucket: () =>
      createClient().storage.from(AUDIO_BUCKET) as unknown as StorageBucketLike,
    createNote: createRecordedNote,
  };
}

/** Peak amplitude of the analyser's current buffer, 0..1. */
export function readLevel(analyser: AnalyserNode): number {
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(buffer);
  let peak = 0;
  for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128) / 128);
  return peak;
}

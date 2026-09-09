import type { TagToken } from "@/lib/notes/tags";

/** Tailwind cannot build a class name at runtime, so each tag token maps to a
 *  static pair of utilities here. The colours themselves live in
 *  app/globals.css — the same arrangement components/note-detail/
 *  speaker-colors.ts uses, and for the same reason. */

export const TAG_CHIP: Record<TagToken, string> = {
  "tag-1": "bg-tag-1-fill text-tag-1",
  "tag-2": "bg-tag-2-fill text-tag-2",
  "tag-3": "bg-tag-3-fill text-tag-3",
  "tag-4": "bg-tag-4-fill text-tag-4",
  "tag-5": "bg-tag-5-fill text-tag-5",
};

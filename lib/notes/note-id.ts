/**
 * Whether a string is shaped like a note id — a uuid, 8-4-4-4-12 hex.
 *
 * A note id arrives from the URL, so it can be anything. Postgres refuses a
 * malformed uuid with `invalid input syntax for type uuid`, and that error
 * used to reach the page as a crash. Checked before any query, a bad id is
 * simply a note that does not exist, and renders as a 404.
 *
 * Deliberately narrower than what Postgres accepts (braces, no hyphens). The
 * app only ever writes the hyphenated form, from `crypto.randomUUID()`, so a
 * link in any other shape was not made by this app and not-found is correct.
 */
const NOTE_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNoteId(value: string): boolean {
  return NOTE_ID_SHAPE.test(value);
}

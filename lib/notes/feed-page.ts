/**
 * How much of the Dashboard feed is on screen, and the link that shows more.
 *
 * Replaced the flat 100-row cap on 2026-09-25 (#4). The owner's call: the
 * feed opens on the newest FEED_PAGE notes, never a wall of a hundred, and a
 * "Show older notes" link at the end asks for one more page. Older notes are
 * reachable; they are just not all on screen at once.
 *
 * The size lives in the URL as `?show=<n>`, beside `?tag=`, so it is read by
 * the same server query, survives a refresh, and needs no client island. `n`
 * is the TOTAL shown, not a page number: the feed is day-grouped from the
 * newest note down, and re-reading the first n rows keeps every day group
 * whole — an offset page would split a day across two screens.
 */

/** Notes shown on first load, and how many each "Show older" adds. */
export const FEED_PAGE = 20;

/** The most rows one load will ever read, whatever the URL says. A bound on
 *  the query, not a page size anyone is meant to reach by clicking. Kept at
 *  200 because read-feed-notes.ts puts every fetched note id into the chunk
 *  query's URL: 200 uuids is ~7.4KB, where 500 was ~18KB and past common
 *  gateway URL limits. */
export const FEED_MAX = 200;

/** The row limit for a `?show=` value. Junk, repeats and non-positive values
 *  mean one page; anything else rounds up to a whole page, capped at FEED_MAX. */
export function feedLimit(show: string | string[] | undefined): number {
  const n = typeof show === "string" ? Number(show) : NaN;
  if (!Number.isFinite(n) || n <= 0) return FEED_PAGE;
  return Math.min(Math.ceil(n / FEED_PAGE) * FEED_PAGE, FEED_MAX);
}

/** The Dashboard URL that shows one more page, keeping the tag filter. */
export function olderHref(limit: number, tag: string | null): string {
  const params = new URLSearchParams();
  if (tag) params.set("tag", tag);
  params.set("show", String(Math.min(limit + FEED_PAGE, FEED_MAX)));
  return `/?${params.toString()}`;
}

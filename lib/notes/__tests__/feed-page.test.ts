import { describe, expect, it } from "vitest";
import { FEED_MAX, FEED_PAGE, feedLimit, olderHref } from "../feed-page";

describe("feedLimit", () => {
  it("shows one page when nothing is asked for", () => {
    expect(feedLimit(undefined)).toBe(FEED_PAGE);
  });

  it("takes a whole number of pages", () => {
    expect(feedLimit(String(FEED_PAGE * 3))).toBe(FEED_PAGE * 3);
  });

  it("rounds a hand-typed value up to a whole page", () => {
    expect(feedLimit(String(FEED_PAGE + 1))).toBe(FEED_PAGE * 2);
  });

  it("falls back to one page on junk, zero, negatives and repeats", () => {
    for (const bad of ["abc", "0", "-40", "", ["40", "60"]]) {
      expect(feedLimit(bad)).toBe(FEED_PAGE);
    }
  });

  it("never reads more than FEED_MAX rows", () => {
    expect(feedLimit("999999")).toBe(FEED_MAX);
  });
});

describe("olderHref", () => {
  it("asks for one more page", () => {
    expect(olderHref(FEED_PAGE, null)).toBe(`/?show=${FEED_PAGE * 2}`);
  });

  it("keeps the tag filter", () => {
    expect(olderHref(FEED_PAGE, "design review")).toBe(
      `/?tag=design+review&show=${FEED_PAGE * 2}`,
    );
  });
});

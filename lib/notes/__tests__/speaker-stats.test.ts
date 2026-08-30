import { describe, expect, it } from "vitest";
import { computeSpeakerStats } from "../speaker-stats";
import type { Segment, Speaker } from "@/lib/mock/types";

const A: Speaker = { name: "A", initials: "AA", token: "speaker-1" };
const B: Speaker = { name: "B", initials: "BB", token: "speaker-2" };
const C: Speaker = { name: "C", initials: "CC", token: "speaker-3" };

const seg = (id: number, speaker: Speaker, text: string): Segment => ({
  id,
  time: "00:00",
  speaker,
  text,
});

describe("computeSpeakerStats", () => {
  it("splits talk share by word count", () => {
    const stats = computeSpeakerStats([seg(1, A, "one two three"), seg(2, B, "four")]);
    expect(stats.map((s) => s.talk)).toEqual(["75%", "25%"]);
  });

  it("distributes rounding so the shares still sum to 100%", () => {
    // Three equal speakers: 33.33% each floors to 33, leaving 1 point over.
    const stats = computeSpeakerStats([seg(1, A, "x"), seg(2, B, "y"), seg(3, C, "z")]);
    const total = stats.reduce((sum, s) => sum + Number.parseInt(s.talk, 10), 0);
    expect(total).toBe(100);
  });

  it("counts question marks per speaker", () => {
    const stats = computeSpeakerStats([
      seg(1, A, "why? how? really?"),
      seg(2, B, "no questions here"),
    ]);
    expect(stats[0].asked).toBe("3");
    expect(stats[1].asked).toBe("0");
  });

  it("counts filler words case-insensitively, on whole words only", () => {
    // "Um", "like", "you know", "basically" count. "likeness" must not.
    const stats = computeSpeakerStats([seg(1, A, "Um, like, you know, basically likeness")]);
    expect(stats[0].fillers).toBe("4");
  });

  it("returns one row per distinct speaker, in first-appearance order", () => {
    const stats = computeSpeakerStats([seg(1, B, "x"), seg(2, A, "y"), seg(3, B, "z")]);
    expect(stats.map((s) => s.speaker.name)).toEqual(["B", "A"]);
  });

  it("returns an empty list when there are no segments", () => {
    expect(computeSpeakerStats([])).toEqual([]);
  });
});

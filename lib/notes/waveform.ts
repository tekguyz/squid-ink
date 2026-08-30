/** Bar heights as percentages, precomputed from the design's waveform curve.
 *
 *  Held as constants so nothing calls Math in a render path. There is no
 *  column for these: the in-line context timeline bar is an Advanced-phase
 *  feature (ROADMAP.md §8) and nothing generates real amplitude data yet. */
export const WAVEFORM = [
  44, 53, 80, 82, 49, 44, 56, 78, 83, 46, 44, 59, 76, 84, 44, 43, 62,
  73, 85, 47, 42, 64, 70, 85, 50, 41, 67, 67, 85, 53, 39, 69, 64, 85,
  55, 37, 70, 61, 84, 57, 35, 72, 64, 82, 60, 32, 72, 67, 80, 61, 30,
  73, 70, 78, 63, 27, 73, 73, 76, 64, 24, 72, 76, 73, 65, 24, 72, 79,
];

/** Player position. Client state, not persisted. */
export const DEFAULT_PLAYHEAD = "03:31";

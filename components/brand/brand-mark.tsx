/**
 * The Squid Ink mark (issue #80): Bitter 700's opening quote on a green tile, the
 * same look as the primary button (`accent` fill, `on-accent` marks). One component, so the landing page, the auth sheet and the
 * onboarding rail cannot drift. Colours are tokens only, so both themes work
 * with no branching. The shape is the outlined quote from
 * `scripts/brand-icons.mjs`; `__tests__/brand-mark.test.tsx` fails if the two
 * paths differ.
 */
export const QUOTE_PATH =
  "M29.18 32.56Q29.18 35.74 27.24 37.37Q25.29 39 22.91 39Q20.44 39 18.37 37.19Q16.29 35.38 16.29 31.76Q16.29 28.41 18.68 23.38Q21.06 18.35 26.88 12L31.03 14.74Q28.47 19.24 27.54 21.53Q26.62 23.82 26.62 24.97Q26.62 26.12 27.28 27.18Q27.94 28.24 28.56 29.47Q29.18 30.71 29.18 32.56ZM45.85 32.56Q45.85 35.74 43.91 37.37Q41.97 39 39.59 39Q37.12 39 35.09 37.19Q33.06 35.38 33.06 31.76Q33.06 28.41 35.4 23.38Q37.74 18.35 43.56 12L47.71 14.74Q45.15 19.24 44.22 21.53Q43.29 23.82 43.29 24.97Q43.29 26.12 43.96 27.18Q44.62 28.24 45.24 29.47Q45.85 30.71 45.85 32.56Z";

export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className="shrink-0"
    >
      <rect width="64" height="64" className="fill-accent" />
      <path d={QUOTE_PATH} className="fill-on-accent" />
      <rect x="21" y="44" width="22" height="9" className="fill-on-accent" />
    </svg>
  );
}

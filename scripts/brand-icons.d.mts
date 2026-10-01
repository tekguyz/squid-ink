export type MarkColours = {
  paper: string;
  ink: string;
  accent: string;
  "rule-strong": string;
};
export type MarkTokens = { light: MarkColours; dark: MarkColours };

export function oklchToHex(value: string): string;
export function readTokens(css: string): MarkTokens;
export function buildIconSvg(tokens: MarkTokens): string;
export function markSvg(
  colours: MarkColours,
  options?: { frame?: boolean },
): string;
export function icoFromPngs(images: { size: number; data: Buffer }[]): Buffer;
export function standaloneSvg(colours: MarkColours, options?: { frame?: boolean }): string;

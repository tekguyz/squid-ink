export type MarkColours = {
  accent: string;
  "on-accent": string;
};
export type MarkTokens = { light: MarkColours; dark: MarkColours };

export function oklchToHex(value: string): string;
export function readTokens(css: string): MarkTokens;
export function buildIconSvg(tokens: MarkTokens): string;
export function markSvg(colours: MarkColours): string;
export function icoFromPngs(images: { size: number; data: Buffer }[]): Buffer;
export function standaloneSvg(colours: MarkColours): string;

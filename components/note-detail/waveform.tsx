import { memo } from "react";

export interface WaveformProps {
  bars: number[];
  playhead: string;
  duration: string;
}

function WaveformBars({ bars, playhead, duration }: WaveformProps) {
  return (
    <>
      <div aria-hidden className="mt-3 flex h-8 items-end gap-[1.5px]">
        {bars.map((height, i) => (
          <span
            key={i}
            className="w-full bg-waveform"
            style={{ height: `${height}%` }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-meta-4">
        <span>00:00</span>
        <span className="text-accent-pressed">▮ {playhead}</span>
        <span>{duration}</span>
      </div>
    </>
  );
}

/** 68 bars that never change while the note is open — memoised so a citation
 *  click does not re-render all of them. */
export const Waveform = memo(WaveformBars);

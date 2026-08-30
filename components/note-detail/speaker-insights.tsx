import type { SpeakerStat } from "@/lib/mock/types";
import { SectionRule } from "./section-rule";
import { SPEAKER_TEXT } from "./speaker-colors";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      {label}
      <br />
      <span className="text-sm text-ink-stat">{value}</span>
    </div>
  );
}

export function SpeakerInsights({ stats }: { stats: SpeakerStat[] }) {
  return (
    <section className="pb-6">
      <SectionRule label="Per-speaker" />
      <ul className="grid grid-cols-3 gap-[9px]">
        {stats.map((stat) => (
          <li
            key={stat.speaker.name}
            className="border border-rule-2 bg-canvas px-[11px] py-2.5"
          >
            <div
              className={`font-header text-sm font-semibold ${SPEAKER_TEXT[stat.speaker.token]}`}
            >
              {stat.speaker.name}
            </div>
            <div className="mt-[7px] flex gap-[13px] font-mono text-[9px] text-meta-5">
              <Stat label="talk" value={stat.talk} />
              <Stat label="asked" value={stat.asked} />
              <Stat label="fillers" value={stat.fillers} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

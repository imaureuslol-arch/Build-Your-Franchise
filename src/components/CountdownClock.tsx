"use client";

/**
 * Arena-style countdown: four lit digit panels (days, hours, minutes,
 * seconds) with blinking separators. Teal while there's time, hot pink in
 * the final 24 hours.
 */

interface Props {
  deadline: string;
  /** Current time in ms, kept in step with the server clock by the page. */
  now: number;
  label?: string;
}

export default function CountdownClock({ deadline, now, label = "Time until bidding closes" }: Props) {
  const total = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
  const units = [
    { value: Math.floor(total / 86400), label: "Days" },
    { value: Math.floor((total % 86400) / 3600), label: "Hrs" },
    { value: Math.floor((total % 3600) / 60), label: "Min" },
    { value: total % 60, label: "Sec" },
  ];
  const final = total < 86400;

  return (
    <div role="timer" aria-label={`${label}: ${units.map((u) => `${u.value} ${u.label}`).join(" ")}`}
      className={`scoreboard flex items-start gap-1.5 sm:gap-2 ${final ? "scoreboard-final" : ""}`}>
      {units.map((u, i) => (
        <div key={u.label} className="flex items-start gap-1.5 sm:gap-2">
          {i > 0 && <span aria-hidden className="scoreboard-sep">:</span>}
          <div className="flex flex-col items-center">
            <span aria-hidden className="scoreboard-digits">
              {String(u.value).padStart(i === 0 && u.value > 99 ? 3 : 2, "0")}
            </span>
            <span aria-hidden className="mt-1 font-blocky font-bold italic uppercase text-xs tracking-widest text-text-muted">
              {u.label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

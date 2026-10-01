import type { PickValue } from "@/lib/pick-value";

export function pickProjectionDescription(value: PickValue): string {
  const horizon = value.yearsAway;
  return `${horizon ? "Forecast" : "Current"} PWR ${value.power ?? "unknown"} (current ${value.currentPower ?? "unknown"}); projected slot #${value.slot} (current #${value.currentSlot}). `
    + `${Math.round(value.discount * 100)}% of value kept after a 20% discount per year beyond the next draft. `
    + `${Math.round(value.certainty * 100)}% weight on the projected slot; the rest uses the round average. `
    + "Future PWR estimates development, aging and retirement risk on today's roster; future trades/signings are unknown. Retirement risk is a planning assumption, not a prediction about a specific player.";
}

export default function PickBadge({ value, currentPower, className = "" }: { value?: PickValue; currentPower?: number; className?: string }) {
  return <span className={`font-mono text-xs text-text-dim ${className}`} title={value ? pickProjectionDescription(value) : "Current team power; forecast unavailable"}>
    {value?.yearsAway ? "PROJ " : ""}PWR {value?.power ?? currentPower ?? "–"}
    {value && <> · #{value.slot} · ${value.fairValue.toFixed(1)}M</>}
  </span>;
}

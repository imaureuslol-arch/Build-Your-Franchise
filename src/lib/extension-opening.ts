import { createHash } from "node:crypto";
import { askingPrice } from "./extensions";
import { dialogueLine, extensionTier } from "./extension-dialogue";
import { formatSalary } from "./types";

/** Owner account + player + season, never session, device, visit, or selected term. */
export function extensionOpening(owner: string, playerId: number, season: number, fairValue: number, age: number, years: number[]) {
  const digest = createHash("sha256").update(JSON.stringify(["byf-extension-opening-v1", owner, playerId, season])).digest();
  const seed = digest.readUInt32BE(4);
  const reveal = digest.readUInt32BE(0) / 0x1_0000_0000 < 0.2;
  const ask = askingPrice(fairValue, age, years);
  const tier = extensionTier(fairValue, ask, years[0]);
  const opening = dialogueLine(tier, "opening", seed);
  const price = years.map((year) => `${formatSalary(ask.perYear[year])} in ${year}`).join(", ");
  return {
    tier,
    seed,
    text: reveal ? `${opening} ${dialogueLine(tier, "quote", digest.readUInt32BE(8), price)}` : opening,
    // Never send the concealed price or server seed to the browser.
    ...(reveal ? { askingPrice: ask.perYear } : {}),
  };
}

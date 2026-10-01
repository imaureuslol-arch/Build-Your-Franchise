import { Player, FREE_AGENCY_TEAM, getCapStatus, getCurrentSalary, getTeamTotalCap, isDeadCap, isPick, decodePickId } from "./types";

export interface ScoutInfo { fairValue: number | null; age: number | null; positions: string[] }
export interface PlayerRule { id: number; count: number; position: string; ageUnder: number | null; fppgOver: number | null }
export interface FinderFilters {
  playersMin: number; playersMax: number; picksMin: number; picksMax: number;
  pickRound: string; salaryMax: number | null; valueTolerance: number | null;
  rules: PlayerRule[]; sort: "value" | "fppg" | "cost";
}
export interface TradeMatch { team: string; assets: Player[]; salary: number; value: number; difference: number; fppg: number }
export interface SearchProgress { checked: number; teamsDone: number; teamsTotal: number; matches: TradeMatch[] }

export function matchesRule(player: Player, info: ScoutInfo | undefined, rule: PlayerRule): boolean {
  return !isPick(player)
    && (rule.position === "any" || !!info?.positions.includes(rule.position))
    && (rule.ageUnder === null || (info?.age != null && info.age < rule.ageUnder))
    && (rule.fppgOver === null || (player.ppg != null && player.ppg > rule.fppgOver));
}

function* combinations(items: Player[], min: number, max: number, start = 0, chosen: Player[] = []): Generator<Player[]> {
  if (chosen.length >= min) yield [...chosen];
  if (chosen.length >= max) return;
  for (let i = start; i < items.length; i++) {
    chosen.push(items[i]);
    yield* combinations(items, min, max, i + 1, chosen);
    chosen.pop();
  }
}

/** Exhaustive, resumable search; yields regularly so controls and cancellation stay responsive. */
export function* findTrades(
  allPlayers: Player[], picks: Player[], info: Record<number, ScoutInfo>,
  pickValues: Record<number, { fairValue: number }>, team: string, outgoing: Player[], filters: FinderFilters,
): Generator<SearchProgress, TradeMatch[]> {
  const valueOf = (p: Player) => isPick(p) ? pickValues[p.id]?.fairValue : info[p.id]?.fairValue;
  if (!outgoing.length || outgoing.some((p) => valueOf(p) == null)) return [];
  const outgoingValue = outgoing.reduce((n, p) => n + valueOf(p)!, 0);
  const outgoingSalary = getTeamTotalCap(outgoing);
  const caps = new Map<string, number>();
  for (const p of allPlayers) caps.set(p.team, (caps.get(p.team) ?? 0) + (getCurrentSalary(p) ?? 0));
  const teams = [...caps.keys()].filter((t) => t && t !== team && t !== FREE_AGENCY_TEAM).sort();
  const capAllows = (t: string, salaryOut: number, salaryIn: number) => {
    const status = getCapStatus(caps.get(t) ?? 0);
    return status === "over" ? salaryIn < salaryOut : status === "yellow" ? salaryIn <= salaryOut : true;
  };
  const compare = (a: TradeMatch, b: TradeMatch) => {
    const primary = filters.sort === "fppg" ? b.fppg - a.fppg : filters.sort === "cost" ? a.salary - b.salary : a.difference - b.difference;
    return primary || a.difference - b.difference || a.salary - b.salary || a.team.localeCompare(b.team)
      || a.assets.map((p) => p.id).join(",").localeCompare(b.assets.map((p) => p.id).join(","));
  };
  let best: TradeMatch[] = [];
  let checked = 0;
  let teamsDone = 0;
  for (const otherTeam of teams) {
    const players = allPlayers.filter((p) => p.team === otherTeam && !isDeadCap(p) && valueOf(p) != null);
    const eligiblePicks = picks.filter((p) => p.team === otherTeam && valueOf(p) != null
      && (filters.pickRound === "any" || decodePickId(p.id).round === Number(filters.pickRound)));
    const pickCombos = [...combinations(eligiblePicks, filters.picksMin, filters.picksMax)];
    for (const playersIn of combinations(players, filters.playersMin, filters.playersMax)) {
      checked++;
      if (checked % 512 === 0) yield { checked, teamsDone, teamsTotal: teams.length, matches: [] };
      const salary = getTeamTotalCap(playersIn);
      if (filters.salaryMax !== null && salary >= filters.salaryMax) continue;
      if (!capAllows(team, outgoingSalary, salary) || !capAllows(otherTeam, salary, outgoingSalary)) continue;
      // Conditions in each rule must all hold for the same player; separate rules may overlap.
      if (!filters.rules.every((r) => playersIn.filter((p) => matchesRule(p, info[p.id], r)).length >= r.count)) continue;
      for (const picksIn of pickCombos) {
        checked++;
        if (checked % 512 === 0) yield { checked, teamsDone, teamsTotal: teams.length, matches: [] };
        const assets = [...playersIn, ...picksIn];
        if (!assets.length) continue;
        const value = assets.reduce((n, p) => n + valueOf(p)!, 0);
        const difference = Math.abs(value - outgoingValue);
        if (filters.valueTolerance !== null && difference > outgoingValue * filters.valueTolerance) continue;
        best.push({ team: otherTeam, assets, salary, value, difference, fppg: playersIn.reduce((n, p) => n + (p.ppg ?? 0), 0) });
        if (best.length >= 100) best = best.sort(compare).slice(0, 50);
      }
    }
    teamsDone++;
    yield { checked, teamsDone, teamsTotal: teams.length, matches: [] };
  }
  return best.sort(compare).slice(0, 50);
}

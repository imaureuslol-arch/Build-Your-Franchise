export interface Player {
  id: number;
  name: string;
  team: string;
  /** Salary by season (keyed by the year the season ends), within SALARY_YEARS. */
  salaries: Record<number, number>;
  ppg: number | null;
  avg_gp: number | null;
}

export interface TeamOwner {
  team_name: string;
  user_name: string;
  conference: string | null;
}

export interface TeamSummary {
  team: string;
  userName: string;
  conference: string;
  players: Player[];
  totalCap: number;
  capStatus: "under" | "yellow" | "over";
}

export interface TradeTeam {
  team: string;
  playersOut: Player[];
  playersIn: Player[];
  retainedSalary?: number;
  incomingRetained?: number;
}

export interface ExtensionOffer {
  years: number[];
  amounts: { [year: number]: number };
}

export interface ChatMessage {
  role: "user" | "player";
  content: string;
  offer?: ExtensionOffer;
}

/** Contracts, extensions and bids cover this many seasons, starting with the current one. */
export const SEASON_WINDOW = 4;

/** The seasons contracts can cover right now: the current one and the next three. */
export function getSalaryYears(): number[] {
  const start = getCurrentSeasonYear();
  return Array.from({ length: SEASON_WINDOW }, (_, i) => start + i);
}

/**
 * Snapshot of getSalaryYears() taken when the module loads. It moves on by
 * itself every April 1; a page or server instance that was loaded before the
 * rollover catches up on its next load.
 */
export const SALARY_YEARS: readonly number[] = getSalaryYears();

// From the league's Salary Cap sheet (2026-27 season).
export const HARD_CAP_BASE = 240_000_000;
export const SOFT_CAP_BASE = 215_000_000;
const CAP_BASE_YEAR = 2027;
const CAP_INCREASE_PER_YEAR = 25_000_000 / 3;
const FAIR_VALUE_GROWTH_RATE = 0.05; // 5% per year
// League minimums from the Salary Cap sheet: $4,166,667 vet / $2,166,667
// rookie in 2026-27, each rising $166,667 a season.
const VET_MIN_BASE = 25_000_000 / 6;
const ROOKIE_MIN_BASE = 13_000_000 / 6;
const MIN_INCREASE_PER_YEAR = 1_000_000 / 6;

/** Veteran minimum salary for a season. */
export function getVetMin(year?: number): number {
  const y = year ?? getCurrentSeasonYear();
  return Math.round(VET_MIN_BASE + Math.max(0, y - CAP_BASE_YEAR) * MIN_INCREASE_PER_YEAR);
}

/** Rookie minimum salary for a season. */
export function getRookieMin(year?: number): number {
  const y = year ?? getCurrentSeasonYear();
  return Math.round(ROOKIE_MIN_BASE + Math.max(0, y - CAP_BASE_YEAR) * MIN_INCREASE_PER_YEAR);
}

/** Hard cap for a given season year ($240M in 2027, +$8.33M/yr) */
export function getHardCap(year?: number): number {
  const y = year ?? getCurrentSeasonYear();
  const yearsAfterBase = Math.max(0, y - CAP_BASE_YEAR);
  return Math.round(HARD_CAP_BASE + yearsAfterBase * CAP_INCREASE_PER_YEAR);
}

/** Soft cap for a given season year ($215M in 2027, +$8.33M/yr) */
export function getSoftCap(year?: number): number {
  const y = year ?? getCurrentSeasonYear();
  const yearsAfterBase = Math.max(0, y - CAP_BASE_YEAR);
  return Math.round(SOFT_CAP_BASE + yearsAfterBase * CAP_INCREASE_PER_YEAR);
}

/** Inflate a base fair value (current season) to a future year at 5%/yr */
export function getFairValueForYear(baseFV: number, year: number): number {
  const currentYear = getCurrentSeasonYear();
  const yearsAhead = Math.max(0, year - currentYear);
  return baseFV * (1 + FAIR_VALUE_GROWTH_RATE) ** yearsAhead;
}

/** Season transition: on or after April 1 of year Y → season year is Y+1 */
export function getCurrentSeasonYear(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed: March=2, April=3
  return month >= 3 ? year + 1 : year;
}

/** Get a player's salary for a specific year */
export function getPlayerSalary(player: Player, year: number): number | null {
  return player.salaries[year] ?? null;
}

/** Get a player's salary for the current season year */
export function getCurrentSalary(player: Player): number | null {
  return getPlayerSalary(player, getCurrentSeasonYear());
}

export const FREE_AGENCY_TEAM = "Free Agency";
export const DEAD_CAP_NAME = "Dead Cap";

/** Returns true if the player is a Dead Cap entry */
export function isDeadCap(player: { name: string }): boolean {
  return player.name === DEAD_CAP_NAME;
}

/*
 * Draft picks travel through trades as salary-free "players" with an id that
 * encodes the pick: -(season * 1000 + round * 100 + original team id). Dead
 * cap uses -(team id), so the two never collide.
 */
export function pickPlayerId(season: number, round: number, originalTeamId: number): number {
  return -(season * 1000 + round * 100 + originalTeamId);
}

export function isPickId(id: number): boolean {
  return id <= -100_000;
}

export function isPick(player: { id: number }): boolean {
  return isPickId(player.id);
}

/** The team a pick originally belongs to, from its label "2028 1st (Team)". */
export function pickOriginalTeam(player: { name: string }): string {
  return player.name.match(/\((.+)\)$/)?.[1] ?? "";
}

export function decodePickId(id: number): { season: number; round: number; originalTeamId: number } {
  const n = -id;
  return { season: Math.floor(n / 1000), round: Math.floor((n % 1000) / 100), originalTeamId: n % 100 };
}

export function getTeamTotalCap(players: Player[]): number {
  return players.reduce((sum, p) => sum + (getCurrentSalary(p) || 0), 0);
}

export function getCapStatus(totalCap: number, year?: number): "under" | "yellow" | "over" {
  if (totalCap > getHardCap(year)) return "over";
  if (totalCap > getSoftCap(year)) return "yellow";
  return "under";
}

export function formatSalary(amount: number | null): string {
  if (amount == null || amount === 0) return "-";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    // Whole millions stay "$42M"; anything else (league minimums) shows one decimal.
    const m = abs / 1_000_000;
    return `${sign}$${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toLocaleString()}`;
}

export function isEligibleForExtension(player: Player): boolean {
  if (isDeadCap(player)) return false;
  return getExtensionYears(player).length > 0 && getCurrentSalary(player) != null;
}

/**
 * Seasons an extension can add: those after the player's contract ends,
 * up to the end of the window. Empty if his deal already runs to the end.
 */
export function getExtensionYears(player: Player): number[] {
  const years = getSalaryYears();
  let lastContractYear = 0;
  for (const year of years) {
    if (getPlayerSalary(player, year) != null) lastContractYear = year;
  }
  return lastContractYear ? years.filter((y) => y > lastContractYear) : [];
}

export function validateTrade(
  teams: TradeTeam[],
  allPlayers: Player[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const tradeTeam of teams) {
    if (tradeTeam.playersOut.length === 0 && tradeTeam.playersIn.length === 0) {
      continue;
    }

    const teamPlayers = allPlayers.filter((p) => p.team === tradeTeam.team);
    const currentCap = getTeamTotalCap(teamPlayers);
    const capStatus = getCapStatus(currentCap);

    const outgoingSalary = tradeTeam.playersOut.reduce(
      (sum, p) => sum + (getCurrentSalary(p) || 0), 0
    );
    const incomingSalary = tradeTeam.playersIn.reduce(
      (sum, p) => sum + (getCurrentSalary(p) || 0), 0
    );
    const retained = tradeTeam.retainedSalary ?? 0;
    const inRetained = tradeTeam.incomingRetained ?? 0;

    // Effective: outgoing minus what you retain (stays as dead cap), incoming minus what other teams retain
    const effectiveOut = outgoingSalary - retained;
    const effectiveIn = incomingSalary - inRetained;

    if (capStatus === "over") {
      if (effectiveIn >= effectiveOut) {
        errors.push(
          `${tradeTeam.team} is over the hard cap ($${Math.round(currentCap / 1_000_000)}M) and must trade away MORE salary than they take on. ` +
            `Out: ${formatSalary(effectiveOut)}, In: ${formatSalary(effectiveIn)}`
        );
      }
    } else if (capStatus === "yellow") {
      if (effectiveIn > effectiveOut) {
        errors.push(
          `${tradeTeam.team} is in the soft cap zone ($${Math.round(currentCap / 1_000_000)}M) and can only match salary. ` +
            `Out: ${formatSalary(effectiveOut)}, In: ${formatSalary(effectiveIn)}`
        );
      }
    }
  }

  const allOut = teams.flatMap((t) => t.playersOut.map((p) => ({ ...p, fromTeam: t.team })));
  const allIn = teams.flatMap((t) => t.playersIn.map((p) => ({ ...p, toTeam: t.team })));

  for (const outPlayer of allOut) {
    const received = allIn.filter((p) => p.name === outPlayer.name);
    if (received.length === 0) {
      errors.push(`${outPlayer.name} is being sent out by ${outPlayer.fromTeam} but not received by any team.`);
    } else if (received.length > 1) {
      errors.push(`${outPlayer.name} is being received by multiple teams.`);
    }
  }

  for (const inPlayer of allIn) {
    const sent = allOut.filter((p) => p.name === inPlayer.name);
    if (sent.length === 0) {
      errors.push(`${inPlayer.name} is being received but not sent by any team.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

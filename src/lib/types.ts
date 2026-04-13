export interface PlayerRaw {
  id: number;
  name: string;
  team: string;
  contract_27: string | null;
  contract_28: string | null;
  contract_29: string | null;
  contract_30: string | null;
  user_name: string | null;
  ppg: number | null;
  avg_gp: number | null;
}

export interface Player {
  id: number;
  name: string;
  team: string;
  contract_27: number | null;
  contract_28: number | null;
  contract_29: number | null;
  contract_30: number | null;
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

export interface ConfirmedTrade {
  id: string;
  teams: TradeTeam[];
  timestamp: number;
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

export const SALARY_YEARS = [2027, 2028, 2029, 2030] as const;
export type SalaryYear = (typeof SALARY_YEARS)[number];

export const HARD_CAP_BASE = 250_000_000;
export const SOFT_CAP_BASE = 225_000_000;
const CAP_BASE_YEAR = 2027;
const CAP_INCREASE_PER_YEAR = 25_000_000;
const FAIR_VALUE_GROWTH_RATE = 0.05; // 5% per year

/** Hard cap for a given season year ($250M in 2027, +$25M/yr from 2028) */
export function getHardCap(year?: number): number {
  const y = year ?? getCurrentSeasonYear();
  const yearsAfterBase = Math.max(0, y - CAP_BASE_YEAR);
  return HARD_CAP_BASE + yearsAfterBase * CAP_INCREASE_PER_YEAR;
}

/** Soft cap for a given season year ($225M in 2027, +$25M/yr from 2028) */
export function getSoftCap(year?: number): number {
  const y = year ?? getCurrentSeasonYear();
  const yearsAfterBase = Math.max(0, y - CAP_BASE_YEAR);
  return SOFT_CAP_BASE + yearsAfterBase * CAP_INCREASE_PER_YEAR;
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

type ContractKey = "contract_27" | "contract_28" | "contract_29" | "contract_30";

const YEAR_TO_CONTRACT: Record<number, ContractKey> = {
  2027: "contract_27",
  2028: "contract_28",
  2029: "contract_29",
  2030: "contract_30",
};

/** Get a player's salary for a specific year */
export function getPlayerSalary(player: Player, year: number): number | null {
  const key = YEAR_TO_CONTRACT[year];
  return key ? player[key] : null;
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

/** Parse "$42,000,000" -> 42000000, or null. Supports negatives like "-$5,000,000" */
export function parseSalary(value: string | null): number | null {
  if (!value) return null;
  const negative = value.trim().startsWith("-");
  const cleaned = value.replace(/[-$,]/g, "").trim();
  const num = Number(cleaned);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/** Convert a raw DB row into a Player with numeric salaries */
export function parsePlayer(raw: PlayerRaw): Player {
  return {
    id: raw.id,
    name: raw.name,
    team: raw.team,
    contract_27: parseSalary(raw.contract_27),
    contract_28: parseSalary(raw.contract_28),
    contract_29: parseSalary(raw.contract_29),
    contract_30: parseSalary(raw.contract_30),
    ppg: raw.ppg,
    avg_gp: raw.avg_gp,
  };
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
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toLocaleString()}`;
}

export function isEligibleForExtension(player: Player): boolean {
  if (isDeadCap(player)) return false;
  const currentYear = getCurrentSeasonYear();
  for (let i = 0; i < SALARY_YEARS.length - 1; i++) {
    const year = SALARY_YEARS[i];
    const nextYear = SALARY_YEARS[i + 1];
    if (year < currentYear) continue;
    if (getPlayerSalary(player, year) != null && getPlayerSalary(player, nextYear) == null) {
      return true;
    }
  }
  return false;
}

export function getExtensionYears(player: Player): number[] {
  const currentYear = getCurrentSeasonYear();
  let lastContractYear = 0;
  for (const year of SALARY_YEARS) {
    if (year < currentYear) continue;
    if (getPlayerSalary(player, year) != null) lastContractYear = year;
  }
  return SALARY_YEARS.filter((y) => y > lastContractYear);
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
          `${tradeTeam.team} is over the hard cap ($${(currentCap / 1_000_000).toFixed(1)}M) and must trade away MORE salary than they take on. ` +
            `Out: ${formatSalary(effectiveOut)}, In: ${formatSalary(effectiveIn)}`
        );
      }
    } else if (capStatus === "yellow") {
      if (effectiveIn > effectiveOut) {
        errors.push(
          `${tradeTeam.team} is in the soft cap zone ($${(currentCap / 1_000_000).toFixed(1)}M) and can only match salary. ` +
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

export interface PlayerRaw {
  id: number;
  name: string;
  team: string;
  contract_27: string | null;
  contract_28: string | null;
  contract_29: string | null;
  contract_30: string | null;
  user_name: string | null;
}

export interface Player {
  id: number;
  name: string;
  team: string;
  contract_27: number | null;
  contract_28: number | null;
  contract_29: number | null;
  contract_30: number | null;
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

export const HARD_CAP = 250_000_000;
export const SOFT_CAP = 225_000_000;

export const FREE_AGENCY_TEAM = "Free Agency";

/** Parse "$42,000,000" -> 42000000, or null */
export function parseSalary(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,]/g, "").trim();
  const num = Number(cleaned);
  return isNaN(num) ? null : num;
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
  };
}

export function getTeamTotalCap(players: Player[]): number {
  return players.reduce((sum, p) => sum + (p.contract_27 || 0), 0);
}

export function getCapStatus(totalCap: number): "under" | "yellow" | "over" {
  if (totalCap > HARD_CAP) return "over";
  if (totalCap > SOFT_CAP) return "yellow";
  return "under";
}

export function formatSalary(amount: number | null): string {
  if (!amount) return "-";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toLocaleString()}`;
}

export function isEligibleForExtension(player: Player): boolean {
  const expiringAfter27 = player.contract_27 != null && player.contract_28 == null;
  const expiringAfter28 = player.contract_28 != null && player.contract_29 == null;
  return expiringAfter27 || expiringAfter28;
}

export function getExtensionYears(player: Player): number[] {
  if (player.contract_27 != null && player.contract_28 == null) {
    return [2028, 2029, 2030];
  }
  if (player.contract_28 != null && player.contract_29 == null) {
    return [2029, 2030];
  }
  return [];
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
      (sum, p) => sum + (p.contract_27 || 0), 0
    );
    const incomingSalary = tradeTeam.playersIn.reduce(
      (sum, p) => sum + (p.contract_27 || 0), 0
    );

    if (capStatus === "over") {
      if (incomingSalary >= outgoingSalary) {
        errors.push(
          `${tradeTeam.team} is over the hard cap ($${(currentCap / 1_000_000).toFixed(1)}M) and must trade away MORE salary than they take on. ` +
            `Out: ${formatSalary(outgoingSalary)}, In: ${formatSalary(incomingSalary)}`
        );
      }
    } else if (capStatus === "yellow") {
      if (incomingSalary > outgoingSalary) {
        errors.push(
          `${tradeTeam.team} is in the soft cap zone ($${(currentCap / 1_000_000).toFixed(1)}M) and can only match salary. ` +
            `Out: ${formatSalary(outgoingSalary)}, In: ${formatSalary(incomingSalary)}`
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

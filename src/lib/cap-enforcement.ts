import { sql } from "./db";

export interface WaiverResult {
  ok: boolean;
  waiverId: number;
  playerId: number;
  player: string;
  fromTeam: number;
  season: number;
  deadCap: number;
  payroll: number;
  sleeperPending: boolean;
}

/** Idempotent; the database clock, payroll and deadlines decide all releases. */
export async function enforceHardCap(): Promise<{ waived: WaiverResult[]; unresolved: { teamId: number; payroll: number; reason: string }[] }> {
  const [row] = await sql`select byf_enforce_hard_cap() as result`;
  return row.result;
}

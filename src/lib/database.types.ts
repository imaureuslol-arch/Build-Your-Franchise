/**
 * Schema types for the Supabase client.
 *
 * Without a Database generic, @supabase/supabase-js resolves every row to
 * `never`, which makes all inserts and updates fail typecheck. This file
 * mirrors the live `public` schema.
 *
 * Everything here is a `type`, never an `interface`: supabase-js constrains
 * rows to `Record<string, unknown>`, and interfaces don't get the implicit
 * index signature that satisfies it. Declaring these as interfaces silently
 * collapses every row back to `never`.
 *
 * Kept by hand — if you add or change a column (including from the Excel
 * sync), update the matching Row below.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/** Row minus the columns Postgres fills in (defaults / generated keys). */
type Insertable<Row, Optional extends keyof Row = never> = Omit<Row, Optional> &
  Partial<Pick<Row, Optional>>;

type Table<Row, Optional extends keyof Row = never> = {
  Row: Row;
  Insert: Insertable<Row, Optional>;
  Update: Partial<Row>;
  Relationships: [];
};

export type PlayersRow = {
  id: number;
  name: string | null;
  team: string | null;
  contract_27: string | null;
  contract_28: string | null;
  contract_29: string | null;
  contract_30: string | null;
  ppg: number | null;
  avg_gp: number | null;
  birthdate: string | null;
};

export type TeamOwnersRow = {
  team_name: string;
  user_name: string;
  conference: string | null;
};

export type ExtensionsRow = {
  id: string;
  player_id: number;
  player_name: string;
  team_name: string;
  user_name: string;
  years: number[];
  amounts: Json;
  total_value: number;
  accepted: boolean;
  created_at: string;
};

export type FreeAgentOffersRow = {
  id: string;
  player_id: string;
  player_name: string;
  user_name: string;
  team_name: string;
  years: number[];
  amounts: Json;
  total_value: number;
  created_at: string;
};

export type IpTeamMappingsRow = {
  ip: string;
  team_name: string;
  created_at: string | null;
};

export type IpLoginHistoryRow = {
  id: number;
  ip: string;
  team_name: string;
  user_agent: string | null;
  country: string | null;
  /** Added by scripts/pins-schema.sql — distinguishes logins from failed guesses. */
  success: boolean;
  created_at: string;
};

export type CommissionerIpsRow = {
  ip: string;
};

export type SubcommissionerIpsRow = {
  ip: string;
  created_at: string;
};

export type BannedIpsRow = {
  ip: string;
  reason: string | null;
  banned_at: string;
};

/** Created by scripts/pins-schema.sql. RLS-locked: service-role key only. */
export type TeamPinsRow = {
  team_name: string;
  pin_hash: string;
  session_epoch: number;
  updated_at: string;
};

/** Created by scripts/pins-schema.sql. RLS-locked: service-role key only. */
export type PinAttemptsRow = {
  id: number;
  ip: string;
  scope: string;
  success: boolean;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      players: Table<PlayersRow>;
      team_owners: Table<TeamOwnersRow>;
      extensions: Table<ExtensionsRow, "id" | "accepted" | "created_at">;
      free_agent_offers: Table<FreeAgentOffersRow, "id" | "created_at">;
      ip_team_mappings: Table<IpTeamMappingsRow, "created_at">;
      ip_login_history: Table<
        IpLoginHistoryRow,
        "id" | "success" | "created_at"
      >;
      commissioner_ips: Table<CommissionerIpsRow>;
      subcommissioner_ips: Table<SubcommissionerIpsRow, "created_at">;
      banned_ips: Table<BannedIpsRow, "banned_at">;
      team_pins: Table<TeamPinsRow, "session_epoch" | "updated_at">;
      pin_attempts: Table<PinAttemptsRow, "id" | "created_at">;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

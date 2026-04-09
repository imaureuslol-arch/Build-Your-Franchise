"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "./supabase";
import { Player, PlayerRaw, TeamOwner, parsePlayer } from "./types";

export function usePlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const { data, error } = await getSupabase()
        .from("players")
        .select("*")
        .order("name");

      if (error) {
        console.error("Error fetching players:", error);
        setLoading(false);
        return;
      }

      setPlayers((data as PlayerRaw[]).map(parsePlayer));
      setLoading(false);
    }
    fetch();
  }, []);

  return { players, loading };
}

export function useTeamOwners() {
  const [owners, setOwners] = useState<Map<string, TeamOwner>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const { data, error } = await getSupabase()
        .from("team_owners")
        .select("*");

      if (error) {
        console.error("Error fetching team owners:", error);
        setLoading(false);
        return;
      }

      const map = new Map<string, TeamOwner>();
      for (const row of data as TeamOwner[]) {
        map.set(row.team_name, row);
      }
      setOwners(map);
      setLoading(false);
    }
    fetch();
  }, []);

  return { owners, loading };
}

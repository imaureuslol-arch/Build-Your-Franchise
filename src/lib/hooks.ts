"use client";

import { useEffect, useState } from "react";
import type { Player, TeamOwner } from "./types";

interface League {
  players: Player[];
  owners: TeamOwner[];
}

// One /api/league request per page load, shared by every hook that needs it.
let leaguePromise: Promise<League> | null = null;

export function refreshLeague() {
  leaguePromise = null;
  window.dispatchEvent(new Event("byf-league-changed"));
}

function loadLeague(): Promise<League> {
  if (!leaguePromise) {
    leaguePromise = fetch("/api/league")
      .then((r) => {
        if (!r.ok) throw new Error(`league: ${r.status}`);
        return r.json() as Promise<League>;
      })
      .catch((e) => {
        console.error("Error fetching league:", e);
        leaguePromise = null;
        return { players: [], owners: [] };
      });
  }
  return leaguePromise;
}

export function usePlayers() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const update = () => loadLeague().then((l) => {
      setPlayers(l.players);
      setLoading(false);
    });
    update();
    window.addEventListener("byf-league-changed", update);
    return () => window.removeEventListener("byf-league-changed", update);
  }, []);

  return { players, loading };
}

export function useTeamOwners() {
  const [owners, setOwners] = useState<Map<string, TeamOwner>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const update = () => loadLeague().then((l) => {
      setOwners(new Map(l.owners.map((o) => [o.team_name, o])));
      setLoading(false);
    });
    update();
    window.addEventListener("byf-league-changed", update);
    return () => window.removeEventListener("byf-league-changed", update);
  }, []);

  return { owners, loading };
}

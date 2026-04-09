"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from "react";
import { useTeamOwners } from "./hooks";
import TeamPickerModal from "@/components/TeamPickerModal";
import type { TeamOwner } from "./types";

interface UserTeamContextValue {
  /** The team name tied to this browser's IP, or null while loading */
  teamName: string | null;
  /** The full TeamOwner record for the user's team */
  owner: TeamOwner | null;
  /** True while the IP lookup or owners fetch is in flight */
  isLoading: boolean;
}

const UserTeamContext = createContext<UserTeamContextValue>({
  teamName: null,
  owner: null,
  isLoading: true,
});

export function useUserTeam() {
  return useContext(UserTeamContext);
}

export function UserTeamProvider({ children }: { children: ReactNode }) {
  const { owners, loading: ownersLoading } = useTeamOwners();
  const [teamName, setTeamName] = useState<string | null>(null);
  const [identifyLoading, setIdentifyLoading] = useState(true);
  const [needsPicker, setNeedsPicker] = useState(false);

  const LS_KEY = "userTeam";

  useEffect(() => {
    // Check localStorage immediately so there's no flash on reload
    const cached = localStorage.getItem(LS_KEY);

    fetch("/api/identify")
      .then((r) => r.json())
      .then((data: { team: string | null }) => {
        if (data.team) {
          localStorage.setItem(LS_KEY, data.team);
          setTeamName(data.team);
        } else if (cached) {
          // DB doesn't know this IP yet (table missing, new session, etc.)
          // Re-save so the DB catches up, then use the cached value
          fetch("/api/identify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team_name: cached }),
          }).catch(() => {});
          setTeamName(cached);
        } else {
          setNeedsPicker(true);
        }
      })
      .catch(() => {
        // Network/DB error — fall back to localStorage so F5 still works
        if (cached) {
          setTeamName(cached);
        } else {
          setNeedsPicker(true);
        }
      })
      .finally(() => setIdentifyLoading(false));
  }, []);

  async function handleTeamSelect(name: string) {
    localStorage.setItem(LS_KEY, name);
    await fetch("/api/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team_name: name }),
    });
    setTeamName(name);
    setNeedsPicker(false);
  }

  const isLoading = identifyLoading || ownersLoading;
  const owner = teamName ? (owners.get(teamName) ?? null) : null;

  return (
    <UserTeamContext.Provider value={{ teamName, owner, isLoading }}>
      {children}
      {!identifyLoading && needsPicker && (
        <TeamPickerModal onSelect={handleTeamSelect} />
      )}
    </UserTeamContext.Provider>
  );
}

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
  /** True if the caller's IP is in the commissioner_ips whitelist */
  isWhitelisted: boolean;
  /** Switch the current view to a different team (client-only, doesn't touch IP mapping) */
  impersonate: (teamName: string) => void;
}

const UserTeamContext = createContext<UserTeamContextValue>({
  teamName: null,
  owner: null,
  isLoading: true,
  isWhitelisted: false,
  impersonate: () => {},
});

export function useUserTeam() {
  return useContext(UserTeamContext);
}

export function UserTeamProvider({ children }: { children: ReactNode }) {
  const { owners, loading: ownersLoading } = useTeamOwners();
  const [teamName, setTeamName] = useState<string | null>(null);
  const [identifyLoading, setIdentifyLoading] = useState(true);
  const [needsPicker, setNeedsPicker] = useState(false);
  const [isWhitelisted, setIsWhitelisted] = useState(false);

  const LS_KEY = "userTeam";
  const LS_IMPERSONATE_KEY = "impersonateTeam";

  useEffect(() => {
    // Check localStorage immediately so there's no flash on reload
    const cached = localStorage.getItem(LS_KEY);
    const impersonated = localStorage.getItem(LS_IMPERSONATE_KEY);

    // Fire both requests in parallel
    const identifyReq = fetch("/api/identify")
      .then((r) => r.json())
      .catch(() => null);
    const whitelistReq = fetch("/api/identify/whitelist")
      .then((r) => r.json())
      .catch(() => ({ whitelisted: false }));

    Promise.all([identifyReq, whitelistReq])
      .then(([identifyData, whitelistData]: [
        { team: string | null } | null,
        { whitelisted: boolean }
      ]) => {
        const whitelisted = !!whitelistData?.whitelisted;
        setIsWhitelisted(whitelisted);

        // If whitelisted and user has an impersonation active, use that
        if (whitelisted && impersonated) {
          setTeamName(impersonated);
          return;
        }

        if (identifyData?.team) {
          localStorage.setItem(LS_KEY, identifyData.team);
          setTeamName(identifyData.team);
        } else if (cached) {
          // DB doesn't know this IP yet — re-save, use the cached value
          fetch("/api/identify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ team_name: cached }),
          }).catch(() => {});
          setTeamName(cached);
        } else if (whitelisted) {
          // Whitelisted but no team cached — default to nothing, let them pick via dropdown
          setTeamName(null);
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

  function impersonate(name: string) {
    // Client-only override — does NOT touch ip_team_mappings
    localStorage.setItem(LS_IMPERSONATE_KEY, name);
    setTeamName(name);
  }

  const isLoading = identifyLoading || ownersLoading;
  const owner = teamName ? (owners.get(teamName) ?? null) : null;

  return (
    <UserTeamContext.Provider
      value={{ teamName, owner, isLoading, isWhitelisted, impersonate }}
    >
      {children}
      {!identifyLoading && needsPicker && (
        <TeamPickerModal onSelect={handleTeamSelect} />
      )}
    </UserTeamContext.Provider>
  );
}

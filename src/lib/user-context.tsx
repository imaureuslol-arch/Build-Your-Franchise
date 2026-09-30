"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { useTeamOwners } from "./hooks";
import type { TeamOwner } from "./types";

interface UserTeamContextValue {
  /** The team this browser is logged in as, or null */
  teamName: string | null;
  /** The full TeamOwner record for the user's team */
  owner: TeamOwner | null;
  /** True while the identity lookup or owners fetch is in flight */
  isLoading: boolean;
  /** True if the caller is logged in with the commissioner link */
  isWhitelisted: boolean;
  /** True if the caller is a sub-commissioner */
  isSubCommish: boolean;
  /** View the site as a different team (commissioner only, client-side) */
  impersonate: (teamName: string) => void;
  /** Re-run the identity/role lookup */
  refresh: () => Promise<void>;
}

const UserTeamContext = createContext<UserTeamContextValue>({
  teamName: null,
  owner: null,
  isLoading: true,
  isWhitelisted: false,
  isSubCommish: false,
  impersonate: () => {},
  refresh: async () => {},
});

export function useUserTeam() {
  return useContext(UserTeamContext);
}

const LS_IMPERSONATE_KEY = "impersonateTeam";

export function UserTeamProvider({ children }: { children: ReactNode }) {
  const { owners, loading: ownersLoading } = useTeamOwners();
  const [teamName, setTeamName] = useState<string | null>(null);
  const [identifyLoading, setIdentifyLoading] = useState(true);
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [isSubCommish, setIsSubCommish] = useState(false);

  const loadIdentity = useCallback(async () => {
    // The session cookie is HttpOnly, so the server is the only one who can
    // say who this browser is.
    const me = (await fetch("/api/me")
      .then((r) => r.json())
      .catch(() => null)) as { team: string | null; role: string | null } | null;

    const commish = me?.role === "commish";
    setIsWhitelisted(commish);
    setIsSubCommish(me?.role === "subcommish");

    // Only the commissioner may view the site as another team.
    const impersonated = localStorage.getItem(LS_IMPERSONATE_KEY);
    setTeamName(commish && impersonated ? impersonated : (me?.team ?? null));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadIdentity().finally(() => setIdentifyLoading(false));
  }, [loadIdentity]);

  function impersonate(name: string) {
    localStorage.setItem(LS_IMPERSONATE_KEY, name);
    setTeamName(name);
  }

  const isLoading = identifyLoading || ownersLoading;
  const owner = teamName ? (owners.get(teamName) ?? null) : null;

  return (
    <UserTeamContext.Provider
      value={{
        teamName,
        owner,
        isLoading,
        isWhitelisted,
        isSubCommish,
        impersonate,
        refresh: loadIdentity,
      }}
    >
      {children}
    </UserTeamContext.Provider>
  );
}

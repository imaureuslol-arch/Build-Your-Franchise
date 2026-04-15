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
  /** True if the caller's IP is in the commissioner_ips whitelist (super commish) */
  isWhitelisted: boolean;
  /** True if the caller's IP is in the subcommissioner_ips whitelist */
  isSubCommish: boolean;
  /** Switch the current view to a different team (client-only, doesn't touch IP mapping) */
  impersonate: (teamName: string) => void;
}

const UserTeamContext = createContext<UserTeamContextValue>({
  teamName: null,
  owner: null,
  isLoading: true,
  isWhitelisted: false,
  isSubCommish: false,
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
  const [isSubCommish, setIsSubCommish] = useState(false);
  const [banned, setBanned] = useState(false);

  const LS_KEY = "userTeam";
  const LS_IMPERSONATE_KEY = "impersonateTeam";

  useEffect(() => {
    const cached = localStorage.getItem(LS_KEY);
    const impersonated = localStorage.getItem(LS_IMPERSONATE_KEY);

    const identifyReq = fetch("/api/identify")
      .then((r) => r.json())
      .catch(() => null);
    const whitelistReq = fetch("/api/identify/whitelist")
      .then((r) => r.json())
      .catch(() => ({ whitelisted: false }));
    const subcommishReq = fetch("/api/identify/subcommish")
      .then((r) => r.json())
      .catch(() => ({ subcommish: false }));

    Promise.all([identifyReq, whitelistReq, subcommishReq])
      .then(
        ([identifyData, whitelistData, subcommishData]: [
          { team: string | null; banned?: boolean } | null,
          { whitelisted: boolean },
          { subcommish: boolean }
        ]) => {
          if (identifyData?.banned) {
            setBanned(true);
            return;
          }

          const whitelisted = !!whitelistData?.whitelisted;
          const subcommish = !!subcommishData?.subcommish;
          setIsWhitelisted(whitelisted);
          setIsSubCommish(subcommish);

          // Only super-commish gets team impersonation
          if (whitelisted && impersonated) {
            setTeamName(impersonated);
            return;
          }

          if (identifyData?.team) {
            localStorage.setItem(LS_KEY, identifyData.team);
            setTeamName(identifyData.team);
          } else if (cached) {
            fetch("/api/identify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ team_name: cached }),
            }).catch(() => {});
            setTeamName(cached);
          } else if (whitelisted) {
            setTeamName(null);
          } else {
            setNeedsPicker(true);
          }
        }
      )
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
    localStorage.setItem(LS_IMPERSONATE_KEY, name);
    setTeamName(name);
  }

  const isLoading = identifyLoading || ownersLoading;
  const owner = teamName ? (owners.get(teamName) ?? null) : null;

  if (banned) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <div className="bg-surface border border-danger/50 rounded-xl p-8 max-w-md text-center space-y-3">
          <h1 className="text-2xl font-bold text-danger">Access Revoked</h1>
          <p className="text-sm text-text-muted">
            This IP has been banned from the site. Contact the commissioner if
            you believe this is a mistake.
          </p>
        </div>
      </div>
    );
  }

  return (
    <UserTeamContext.Provider
      value={{ teamName, owner, isLoading, isWhitelisted, isSubCommish, impersonate }}
    >
      {children}
      {!identifyLoading && needsPicker && (
        <TeamPickerModal onSelect={handleTeamSelect} />
      )}
    </UserTeamContext.Provider>
  );
}

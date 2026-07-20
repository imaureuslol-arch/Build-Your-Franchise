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
import TeamPickerModal from "@/components/TeamPickerModal";
import type { TeamOwner } from "./types";

interface UserTeamContextValue {
  /** The team this browser has proved ownership of, or null while loading */
  teamName: string | null;
  /** The full TeamOwner record for the user's team */
  owner: TeamOwner | null;
  /** True while the identity lookup or owners fetch is in flight */
  isLoading: boolean;
  /** True if the caller is a super-commissioner (commish PIN or whitelisted IP) */
  isWhitelisted: boolean;
  /** True if the caller is a sub-commissioner */
  isSubCommish: boolean;
  /** Switch the current view to a different team (client-only, doesn't touch IP mapping) */
  impersonate: (teamName: string) => void;
  /** Re-run the identity/role lookup — call after a commish PIN login */
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
  const [needsPicker, setNeedsPicker] = useState(false);
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [isSubCommish, setIsSubCommish] = useState(false);
  const [banned, setBanned] = useState(false);

  const loadIdentity = useCallback(async () => {
    const impersonated = localStorage.getItem(LS_IMPERSONATE_KEY);

    const [identifyData, whitelistData, subcommishData] = await Promise.all([
      fetch("/api/identify")
        .then((r) => r.json())
        .catch(() => null) as Promise<{ team: string | null; banned?: boolean } | null>,
      fetch("/api/identify/whitelist")
        .then((r) => r.json())
        .catch(() => ({ whitelisted: false })) as Promise<{ whitelisted: boolean }>,
      fetch("/api/identify/subcommish")
        .then((r) => r.json())
        .catch(() => ({ subcommish: false })) as Promise<{ subcommish: boolean }>,
    ]);

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
      setNeedsPicker(false);
      return;
    }

    // The server is the only authority on who this browser is: it checks the
    // signed session cookie, then the IP whitelist. There is deliberately no
    // localStorage fallback — that would let anyone claim any team by editing
    // a key, which is exactly what the PIN exists to prevent.
    if (identifyData?.team) {
      setTeamName(identifyData.team);
      setNeedsPicker(false);
    } else if (whitelisted || subcommish) {
      setTeamName(null);
      setNeedsPicker(false);
    } else {
      setTeamName(null);
      setNeedsPicker(true);
    }
  }, []);

  useEffect(() => {
    // loadIdentity awaits the three identity fetches before it touches state,
    // so nothing here updates state synchronously during the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadIdentity().finally(() => setIdentifyLoading(false));
  }, [loadIdentity]);

  /** Returns an error message, or null on success. */
  async function handleTeamSelect(
    name: string,
    pin: string
  ): Promise<string | null> {
    try {
      const res = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_name: name, pin }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (typeof data?.attemptsLeft === "number" && data.attemptsLeft > 0) {
          return `${data.error ?? "Incorrect PIN."} ${data.attemptsLeft} attempt${
            data.attemptsLeft === 1 ? "" : "s"
          } left.`;
        }
        return data?.error ?? "Login failed.";
      }

      setTeamName(name);
      setNeedsPicker(false);
      return null;
    } catch {
      return "Network error — try again.";
    }
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
      {!identifyLoading && needsPicker && (
        <TeamPickerModal onSelect={handleTeamSelect} />
      )}
    </UserTeamContext.Provider>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

interface TeamRow {
  id: number;
  name: string;
  owner_name: string | null;
  link_created: string | null;
}
interface SessionRow {
  id: string;
  team_id: number | null;
  role: string | null;
  user_agent: string | null;
  country: string | null;
  created_at: string;
  last_seen: string;
}

function device(ua: string | null): string {
  if (!ua) return "Unknown device";
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : "Other";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${browser} on ${os}` : os;
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

/** Commissioner panel: issue, copy and revoke each team's login link. */
export default function LoginLinks() {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/commissioner/links");
    if (!res.ok) return;
    const data = await res.json();
    setTeams(data.teams);
    setSessions(data.sessions);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(key: string, body: object): Promise<string | null> {
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch("/api/commissioner/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      await load();
      return data.url ?? null;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function newLink(team: TeamRow) {
    const replacing = !!team.link_created;
    if (replacing && !confirm(`Replace ${team.name}'s link? The old one stops working. Devices already logged in stay logged in.`)) return;
    const url = await act(`link-${team.id}`, { action: "new_link", teamId: team.id });
    if (url) setLinks((p) => ({ ...p, [team.name]: url }));
  }

  async function revoke(team: TeamRow) {
    if (!confirm(`Log out every device of ${team.name} and disable its link?`)) return;
    await act(`revoke-${team.id}`, { action: "revoke_team", teamId: team.id });
  }

  async function newSubcommishLink() {
    if (!confirm("Make a new sub-commissioner link? The previous one stops working.")) return;
    const url = await act("sub", { action: "new_role_link", role: "subcommish" });
    if (url) setLinks((p) => ({ ...p, "Sub-commissioner": url }));
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    setMsg("Copied.");
  }

  const btn = "text-xs px-2.5 py-1 rounded-sm border border-border hover:bg-surface-light disabled:opacity-40";

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-xl text-text">Login Links</h3>
        <button className={btn} disabled={busy === "sub"} onClick={newSubcommishLink}>
          New sub-commissioner link
        </button>
      </div>
      <p className="text-xs text-text-dim">
        Make a link, copy it, and DM it to the owner on Sleeper. A link is only shown once; making a new one
        replaces the old one.
      </p>
      {msg && <p className="text-xs text-text-muted">{msg}</p>}

      {links["Sub-commissioner"] && (
        <div className="bg-primary/10 border border-primary/30 rounded-sm p-3 text-xs flex items-center gap-2">
          <span className="font-semibold shrink-0">Sub-commissioner:</span>
          <code className="truncate flex-1">{links["Sub-commissioner"]}</code>
          <button className={btn} onClick={() => copy(links["Sub-commissioner"])}>Copy</button>
        </div>
      )}

      <div className="bg-surface border border-border rounded-sm divide-y divide-border">
        {teams.map((t) => {
          const devices = sessions.filter((s) => s.team_id === t.id);
          const link = links[t.name];
          return (
            <div key={t.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{t.name}</div>
                  <div className="text-xs text-text-dim">
                    {t.owner_name ?? "No owner in Sleeper"} ·{" "}
                    {t.link_created ? `link made ${ago(t.link_created)}` : "no link yet"} ·{" "}
                    {devices.length} device{devices.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className={btn} disabled={busy === `link-${t.id}`} onClick={() => newLink(t)}>
                    {t.link_created ? "New link" : "Make link"}
                  </button>
                  {(t.link_created || devices.length > 0) && (
                    <button className={`${btn} text-danger`} disabled={busy === `revoke-${t.id}`} onClick={() => revoke(t)}>
                      Log out all
                    </button>
                  )}
                </div>
              </div>
              {link && (
                <div className="bg-primary/10 border border-primary/30 rounded-sm p-2 text-xs flex items-center gap-2">
                  <code className="truncate flex-1">{link}</code>
                  <button className={btn} onClick={() => copy(link)}>Copy</button>
                </div>
              )}
              {devices.length > 0 && (
                <ul className="text-xs text-text-dim space-y-1">
                  {devices.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2">
                      <span>
                        {device(d.user_agent)}
                        {d.country ? ` · ${d.country}` : ""} · last seen {ago(d.last_seen)}
                      </span>
                      <button
                        className="hover:text-danger"
                        onClick={() => act(`s-${d.id}`, { action: "end_session", sessionId: d.id })}
                      >
                        Log out
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

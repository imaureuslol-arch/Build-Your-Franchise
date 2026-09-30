"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useUserTeam } from "@/lib/user-context";
import { useTeamOwners } from "@/lib/hooks";

const baseLinks = [
  { href: "/rosters", label: "Rosters" },
  { href: "/trades", label: "Trades" },
  { href: "/trade-finder", label: "Trade Finder" },
  { href: "/extensions", label: "Extensions" },
  { href: "/free-agency", label: "Free Agency" },
];

export default function Nav() {
  const pathname = usePathname();
  const { teamName, owner, isWhitelisted, isSubCommish, impersonate } = useUserTeam();
  const { owners } = useTeamOwners();
  const [menuOpen, setMenuOpen] = useState(false);

  const links =
    isWhitelisted || isSubCommish
      ? [...baseLinks, { href: "/commissioner", label: "Commish" }]
      : baseLinks;
  const allTeams = Array.from(owners.keys()).sort();

  const who = teamName
    ? owner?.user_name && owner.user_name !== "(no owner)"
      ? `${teamName} · ${owner.user_name}`
      : teamName
    : isWhitelisted || isSubCommish
      ? "Commissioner"
      : "Not logged in";

  const viewAs = isWhitelisted && allTeams.length > 0 && (
    <select
      value={teamName ?? ""}
      onChange={(e) => impersonate(e.target.value)}
      className="bg-transparent border border-border px-1.5 py-0.5 text-xs text-text-muted focus:outline-none focus:border-text"
      title="View the site as another team"
    >
      <option value="" disabled>View as…</option>
      {allTeams.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  );

  return (
    <header className="border-b-2 border-text bg-background">
      {/* Top strip: who you are */}
      <div className="border-b border-border">
        <div className="max-w-7xl mx-auto px-4 h-8 flex items-center justify-end gap-3 text-xs text-text-muted">
          {viewAs && <span className="hidden sm:inline">{viewAs}</span>}
          <Link href="/account" className="hover:text-text hover:underline truncate">
            {who}
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 flex items-end justify-between gap-4 pt-3">
        <Link
          href="/"
          onClick={() => setMenuOpen(false)}
          className="font-blocky font-extrabold uppercase text-3xl sm:text-4xl leading-none tracking-tight pb-2.5 whitespace-nowrap"
        >
          Build Your Franchise
        </Link>

        <nav className="hidden md:flex items-end gap-5 lg:gap-7">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`font-blocky font-bold uppercase text-lg leading-none pb-2.5 border-b-4 -mb-[2px] transition-colors ${
                  active
                    ? "border-primary text-text"
                    : "border-transparent text-text-muted hover:text-text"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className="md:hidden font-blocky font-bold uppercase text-lg pb-2.5 text-text-muted hover:text-text"
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>

      {menuOpen && (
        <nav className="md:hidden border-t border-border">
          <div className="max-w-7xl mx-auto px-4 py-2 flex flex-col">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`font-blocky font-bold uppercase text-xl py-2 border-b border-border last:border-0 ${
                  pathname === link.href ? "text-primary" : "text-text"
                }`}
              >
                {link.label}
              </Link>
            ))}
            {viewAs && <div className="py-2">{viewAs}</div>}
          </div>
        </nav>
      )}
    </header>
  );
}

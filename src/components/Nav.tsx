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
      className="bg-purple-deep border border-white/20 px-1.5 py-0.5 text-xs text-white/70 focus:outline-none focus:border-white"
      title="View the site as another team"
    >
      <option value="" disabled>View as…</option>
      {allTeams.map((t) => (
        <option key={t} value={t}>{t}</option>
      ))}
    </select>
  );

  return (
    <header className="masthead">
      {/* Top strip: who you are */}
      <div className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 h-8 flex items-center justify-end gap-3 text-xs text-white/60">
          {viewAs && <span className="hidden sm:inline">{viewAs}</span>}
          <Link href="/account" className="hover:text-white hover:underline truncate">
            {who}
          </Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 flex items-end justify-between gap-4 pt-3">
        <Link
          href="/"
          onClick={() => setMenuOpen(false)}
          className="font-varsity uppercase text-2xl sm:text-3xl leading-none pb-3 whitespace-nowrap"
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
                className={`font-blocky font-extrabold italic uppercase text-lg leading-none pb-3 border-b-4 transition-colors ${
                  active
                    ? "border-teal text-white"
                    : "border-transparent text-white/60 hover:text-white"
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
          className="md:hidden font-blocky font-extrabold italic uppercase text-lg pb-3 text-white/70 hover:text-white"
        >
          {menuOpen ? "Close" : "Menu"}
        </button>
      </div>

      {menuOpen && (
        <nav className="md:hidden border-t border-white/10">
          <div className="max-w-7xl mx-auto px-4 py-2 flex flex-col">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`font-blocky font-extrabold italic uppercase text-xl py-2 border-b border-white/10 last:border-0 ${
                  pathname === link.href ? "text-teal" : "text-white"
                }`}
              >
                {link.label}
              </Link>
            ))}
            {viewAs && <div className="py-2">{viewAs}</div>}
          </div>
        </nav>
      )}
      <div className="masthead-stripe" />
    </header>
  );
}

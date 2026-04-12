"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useUserTeam } from "@/lib/user-context";

const links = [
  { href: "/", label: "Home" },
  { href: "/rosters", label: "Rosters" },
  { href: "/trades", label: "Trade Machine" },
  { href: "/trade-finder", label: "Trade Finder" },
  { href: "/extensions", label: "Extensions" },
  { href: "/free-agency", label: "Free Agency" },
];

export default function Nav() {
  const pathname = usePathname();
  const { teamName, owner } = useUserTeam();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className="bg-surface border-b border-border relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          <Link
            href="/"
            onClick={() => setMenuOpen(false)}
            className="text-base sm:text-xl font-bold text-primary tracking-tight whitespace-nowrap"
          >
            SLEEPER COMPANION
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-3">
            {teamName && (
              <span className="text-xs text-text-muted">
                <span className="text-text-dim">Playing as</span>{" "}
                <span className="text-accent font-semibold">{owner?.user_name ?? teamName}</span>
              </span>
            )}
            <div className="flex gap-1">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    pathname === link.href
                      ? "bg-primary text-white"
                      : "text-text-muted hover:text-text hover:bg-surface-light"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg text-text-muted hover:text-text hover:bg-surface-light transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-6 h-6"
            >
              {menuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="md:hidden border-t border-border bg-surface">
          <div className="px-4 py-3 flex flex-col gap-1">
            {teamName && (
              <div className="text-xs text-text-muted pb-2 mb-1 border-b border-border">
                <span className="text-text-dim">Playing as</span>{" "}
                <span className="text-accent font-semibold">{owner?.user_name ?? teamName}</span>
              </div>
            )}
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? "bg-primary text-white"
                    : "text-text-muted hover:text-text hover:bg-surface-light"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}

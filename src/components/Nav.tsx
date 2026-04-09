"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserTeam } from "@/lib/user-context";

const links = [
  { href: "/", label: "Home" },
  { href: "/rosters", label: "Rosters" },
  { href: "/trades", label: "Trade Machine" },
  { href: "/extensions", label: "Extensions" },
  { href: "/free-agency", label: "Free Agency" },
];

export default function Nav() {
  const pathname = usePathname();
  const { teamName, owner } = useUserTeam();

  return (
    <nav className="bg-surface border-b border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="text-xl font-bold text-primary tracking-tight">
            SLEEPER COMPANION
          </Link>
          <div className="flex items-center gap-3">
            {teamName && (
              <span className="text-xs text-text-muted hidden sm:block">
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
        </div>
      </div>
    </nav>
  );
}

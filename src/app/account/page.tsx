"use client";

import { useState } from "react";
import { useUserTeam } from "@/lib/user-context";

export default function AccountPage() {
  const { teamName, isWhitelisted, isSubCommish, isLoading } = useUserTeam();
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const loggedIn = !!teamName || isWhitelisted || isSubCommish;

  async function makeDeviceLink() {
    const res = await fetch("/api/me/device-link", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setLink(data.url);
      setCopied(false);
    }
  }

  async function logOut() {
    if (!confirm("Log out on this device? You'll need your link to get back in.")) return;
    await fetch("/api/me/logout", { method: "POST" });
    localStorage.removeItem("impersonateTeam");
    window.location.href = "/";
  }

  if (isLoading) return null;

  return (
    <div className="max-w-md mx-auto px-4 py-10 space-y-6">
      <h1 className="text-4xl">Account</h1>

      {!loggedIn ? (
        <p className="text-sm text-text-muted">
          You&apos;re not logged in on this device. Open the login link the commissioner sent you on
          Sleeper. If you don&apos;t have one, ask them for it.
        </p>
      ) : (
        <>
          <p className="text-sm text-text-muted">
            Logged in as <span className="text-accent font-semibold">{teamName ?? "commissioner"}</span>
            {isWhitelisted ? " · commissioner" : isSubCommish ? " · sub-commissioner" : ""}.
          </p>

          <section className="bg-surface border border-border rounded-sm p-5 space-y-3">
            <h2 className="font-semibold">Add another device</h2>
            <p className="text-sm text-text-muted">
              Makes a link that works once, for 10 minutes. Open it on your phone or other computer.
            </p>
            {link ? (
              <div className="space-y-2">
                <code className="block text-xs break-all bg-surface-light border border-border rounded-sm p-2">{link}</code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(link);
                    setCopied(true);
                  }}
                  className="px-3 py-1.5 text-sm rounded-sm bg-primary text-white"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            ) : (
              <button onClick={makeDeviceLink} className="px-3 py-1.5 text-sm rounded-sm bg-primary text-white">
                Make device link
              </button>
            )}
          </section>

          <button onClick={logOut} className="text-sm text-danger hover:underline">
            Log out on this device
          </button>
        </>
      )}
    </div>
  );
}

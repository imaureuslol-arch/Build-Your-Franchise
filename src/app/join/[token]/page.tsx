"use client";

import { use, useState } from "react";

export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function logIn() {
    setBusy(true);
    const res = await fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      window.location.href = "/";
      return;
    }
    const data = await res.json().catch(() => ({}));
    setError(data.error ?? "Login failed.");
    setBusy(false);
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="card-frame p-8 max-w-sm w-full text-center space-y-4">
        <h1 className="text-xl font-bold">Log in to Build Your Franchise</h1>
        <p className="text-sm text-text-muted">This device will stay logged in for a year.</p>
        <button
          onClick={logIn}
          disabled={busy}
          className="byf-btn byf-btn--primary byf-btn--block"
        >
          {busy ? "Logging in…" : "Log in"}
        </button>
        {error && <p className="byf-alert byf-alert--danger">{error}</p>}
      </div>
    </div>
  );
}

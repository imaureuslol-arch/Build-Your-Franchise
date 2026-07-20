"use client";

import { useState } from "react";
import { useTeamOwners } from "@/lib/hooks";

interface Props {
  /** Resolves to an error message on failure, or null on success. */
  onSelect: (teamName: string, pin: string) => Promise<string | null>;
}

export default function TeamPickerModal({ onSelect }: Props) {
  const { owners, loading } = useTeamOwners();
  const [selected, setSelected] = useState("");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamList = Array.from(owners.values()).sort((a, b) =>
    a.team_name.localeCompare(b.team_name)
  );

  const canSubmit = selected !== "" && pin.length === 4 && !saving;

  async function handleConfirm() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    const message = await onSelect(selected, pin);
    if (message) {
      setError(message);
      setPin("");
      setSaving(false);
    }
    // On success the modal unmounts, so no need to reset state.
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-xl p-6 sm:p-8 max-w-md w-full shadow-2xl">
        <h2 className="text-2xl sm:text-3xl font-bold text-text mb-2 font-[family-name:var(--font-blocky)] tracking-wide uppercase">Welcome</h2>
        <p className="text-text-muted mb-6 text-sm leading-relaxed">
          Select your team and enter the 4-digit PIN the commissioner gave you.
          This device gets remembered, so you&apos;ll only have to do this once.
        </p>

        {loading ? (
          <div className="text-text-muted text-sm">Loading teams…</div>
        ) : (
          <>
            <select
              value={selected}
              onChange={(e) => { setSelected(e.target.value); setError(null); }}
              className="w-full bg-surface-light border border-border rounded-lg px-4 py-3 text-text text-sm mb-3 outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">— Select your team —</option>
              {teamList.map((o) => (
                <option key={o.team_name} value={o.team_name}>
                  {o.team_name} ({o.user_name})
                </option>
              ))}
            </select>

            <input
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
                setError(null);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
              placeholder="4-digit PIN"
              className="w-full bg-surface-light border border-border rounded-lg px-4 py-3 text-text text-sm mb-4 tracking-[0.5em] text-center outline-none focus:ring-1 focus:ring-primary"
            />

            {error && (
              <p className="text-danger text-sm mb-4 text-center">{error}</p>
            )}

            <button
              onClick={handleConfirm}
              disabled={!canSubmit}
              className="w-full bg-primary text-white font-semibold py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-hover transition-colors text-sm"
            >
              {saving ? "Checking…" : "Log In"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

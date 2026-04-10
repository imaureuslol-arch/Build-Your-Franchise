"use client";

import { useState } from "react";
import { useTeamOwners } from "@/lib/hooks";

interface Props {
  onSelect: (teamName: string) => Promise<void>;
}

export default function TeamPickerModal({ onSelect }: Props) {
  const { owners, loading } = useTeamOwners();
  const [selected, setSelected] = useState("");
  const [saving, setSaving] = useState(false);

  const teamList = Array.from(owners.values()).sort((a, b) =>
    a.team_name.localeCompare(b.team_name)
  );

  async function handleConfirm() {
    if (!selected || saving) return;
    setSaving(true);
    await onSelect(selected);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-surface border border-border rounded-xl p-6 sm:p-8 max-w-md w-full shadow-2xl">
        <h2 className="text-2xl sm:text-3xl font-bold text-text mb-2 font-[family-name:var(--font-blocky)] tracking-wide uppercase">Welcome</h2>
        <p className="text-text-muted mb-6 text-sm leading-relaxed">
          Select the team you own. This gets locked to your IP address — you'll
          only be able to negotiate extensions and make free-agent offers as
          this team.
        </p>

        {loading ? (
          <div className="text-text-muted text-sm">Loading teams…</div>
        ) : (
          <>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full bg-surface-light border border-border rounded-lg px-4 py-3 text-text text-sm mb-4 outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">— Select your team —</option>
              {teamList.map((o) => (
                <option key={o.team_name} value={o.team_name}>
                  {o.team_name} ({o.user_name})
                </option>
              ))}
            </select>

            <button
              onClick={handleConfirm}
              disabled={!selected || saving}
              className="w-full bg-primary text-white font-semibold py-3 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary-hover transition-colors text-sm"
            >
              {saving ? "Saving…" : "Confirm My Team"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

import CapDeadline from "./CapDeadline";
import type { TeamOwner } from "@/lib/types";

export default function CapWarning({ owner }: { owner?: TeamOwner | null }) {
  if (!owner?.capDeadline) return null;
  return <div className="border border-cap-over bg-cap-over/10 rounded-sm p-3 space-y-1" role="status">
    <p className="text-sm font-semibold text-cap-over"><span aria-hidden="true" className="cap-warning-sign inline-block mr-1">⚠</span>Hard cap warning</p>
    <CapDeadline deadline={owner.capDeadline} />
    <p className="text-xs">Due to be dropped: {owner.capDropPlayers?.map(p => p.name).join(", ") || "No rostered players — contact the commissioner about dead cap"}.</p>
    <p className="text-xs text-text-muted">Lowest-value players go first. The list updates when your roster or player values change.</p>
  </div>;
}

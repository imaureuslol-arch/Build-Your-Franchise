import { sql } from "./db";
import { sendSleeperDm } from "./sleeper-messages";
import { getHardCap } from "./types";

interface Reminder {
  id: string; teamId: number; team: string; recipient: string; deadline: string; daysLeft: number; season: number;
  players: { name: string; salary: number }[];
}

export function capWarningMessage(reminder: Reminder): string {
  const deadline = new Date(reminder.deadline).toLocaleString("en-GB", { timeZone: "Europe/Athens", dateStyle: "medium", timeStyle: "short" });
  const money = (amount: number) => amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return `Hard cap warning: ${reminder.daysLeft}-day alert\nTeam: ${reminder.team}\n`
    + `Get to ${money(getHardCap(reminder.season))} or below by ${deadline} (Athens).\n`
    + `Currently due to be dropped: ${reminder.players.map(p => `${p.name} (${money(p.salary)})`).join(", ") || "No rostered players; contact the commissioner about dead cap"}.\n`
    + "Forced releases erase the full remaining contract. This list can change with your roster and player values.";
}

/** Reserve before every send. An uncertain result is never automatically retried. */
export async function sendCapWarnings(): Promise<void> {
  // Reserve one warning at a time, so a function timeout doesn't reserve unsent messages.
  for (let count = 0; count < 24; count++) {
    const [row] = await sql`select byf_claim_cap_notifications() as reminders`;
    const reminders: Reminder[] = row.reminders;
    if (!reminders.length) return;
    for (const reminder of reminders) {
      // Recheck after claiming in case a trade or waiver resolved the cap meanwhile.
      const [current] = await sql`select deadline from team_cap_status where team_id=${reminder.teamId}`;
      if (!current || Date.parse(current.deadline) !== Date.parse(reminder.deadline)) continue;
      try {
        await sendSleeperDm(reminder.recipient, capWarningMessage(reminder), `byf-cap-${reminder.id}`);
      } catch {
        await sql`update cap_notifications set status='unconfirmed' where id=${reminder.id}::uuid`;
        continue;
      }
      await sql`update cap_notifications set status='sent',sent_at=clock_timestamp() where id=${reminder.id}::uuid`;
    }
  }
}

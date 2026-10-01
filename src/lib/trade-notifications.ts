import { sql } from "./db";
import { sendSleeperDm, SleeperMessageError } from "./sleeper-messages";
import type { TradeInput } from "./trades";
import type { Player } from "./types";

interface NotificationTeam {
  id: number;
  name: string;
  owner_name: string | null;
  sleeper_user_id: string | null;
}

export function tradeOfferMessage(
  input: TradeInput, players: Map<number, Player>, sender: NotificationTeam, recipient: string,
): string {
  const assets = (side: "from" | "to") => input.items.filter(i => i[side] === recipient)
    .map(i => players.get(i.playerId)!.name).join(", ") || "None";
  const lines = [
    "You have received a Trade Offer!",
    `Sender: ${sender.owner_name ? `${sender.owner_name} (${sender.name})` : sender.name}`,
    `You Send: ${assets("from")}`,
    `You Receive: ${assets("to")}`,
  ];
  const retention = input.teams.filter(t => t.retained > 0).map(t =>
    `${t.team}: $${t.retained.toLocaleString("en-US")}`);
  if (retention.length) lines.push(`Salary Retained: ${retention.join(", ")}`);
  return lines.join("\n");
}

/** Called only after a proposal or counter has been saved successfully. */
export async function notifyTradeOffer(
  tradeId: string, revision: number, senderId: number,
  input: TradeInput, players: Map<number, Player>,
): Promise<{ sent: string[]; warnings: string[] }> {
  const sent: string[] = [];
  const warnings: string[] = [];
  try {
    const teams = await sql`select id, name, owner_name, sleeper_user_id from teams
      where name = any(${input.teams.map(t => t.team)})` as NotificationTeam[];
    const sender = teams.find(t => t.id === senderId);
    if (!sender) return { sent, warnings: ["The offer was saved, but its Sleeper notifications could not be sent."] };
    // At most one DM per manager, even if they own multiple receiving teams.
    const recipients = new Map<string, NotificationTeam[]>();
    for (const team of teams.filter(t => t.id !== senderId)) {
      if (!team.sleeper_user_id) {
        warnings.push(`${team.name}: no Sleeper account is linked, so no DM was sent.`);
        continue;
      }
      const userId = String(team.sleeper_user_id);
      recipients.set(userId, [...(recipients.get(userId) ?? []), team]);
    }
    await Promise.all([...recipients].map(async ([userId, receivingTeams]) => {
      const names = receivingTeams.map(t => t.name);
      const text = receivingTeams.map(t => tradeOfferMessage(input, players, sender, t.name)).join("\n\n");
      try {
        await sendSleeperDm(userId, text, `byf-trade-${tradeId}-${revision}-${userId}`);
        sent.push(...names);
      } catch (error) {
        // Only this module's safe messages may leave the server.
        const reason = error instanceof SleeperMessageError ? error.message : "Sleeper did not confirm delivery.";
        warnings.push(`${names.join(", ")}: ${reason}`);
      }
    }));
  } catch {
    warnings.push("The offer was saved, but its Sleeper notifications could not be sent.");
  }
  return { sent, warnings };
}

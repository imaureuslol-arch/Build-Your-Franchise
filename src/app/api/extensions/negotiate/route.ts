import { NextRequest } from "next/server";
import { sql } from "@/lib/db";
import { audit, getViewer, notLoggedIn, type Viewer } from "@/lib/auth";
import {
  MAX_OFFERS,
  fairValuePrice,
  isInsulting,
  offerProblem,
  respond,
  ultimatum,
} from "@/lib/extensions";
import { getExtensionYears, getSalaryYears, type Player } from "@/lib/types";
import { extensionOpening } from "@/lib/extension-opening";
import { dialogueLine, finalDemandLine } from "@/lib/extension-dialogue";
import { adminError } from "@/lib/admin-errors";

/**
 * Extension negotiations, run entirely on the server.
 *
 *   GET  ?player_id=           where this negotiation stands
 *   POST { player_id, action: "offer", years, amounts }
 *   POST { player_id, action: "accept" | "decline" }   answer the final demand
 *
 * The state (offers used, best offer, final demand) lives in
 * extension_negotiations, so reloading the page doesn't reset it. Signing or
 * walking away writes an extensions row and ends the negotiation for good.
 */

type Loaded =
  | { error: string; status: number }
  | {
      player: Player;
      years: number[];
      age: number;
      fairValue: number;
      ownerKey: string;
      contractVersion: number;
      stats: { fairValue: number; age: number; ppg: number; avgGamesPlayed: number | null };
      state: { offers_used: number; best_ratio: number; last_average: number; demand: number | null; demand_years: number[] | null } | null;
    };

async function load(viewer: Viewer, playerId: number): Promise<Loaded> {
  if (viewer.teamId == null) return { error: "Log in with your team link to negotiate.", status: 403 };
  const [row] = await sql`
    select p.id, p.name, p.team_id, p.ppg, p.avg_gp, p.proj_fppg, p.fair_value, p.nba_experience, p.contract_version,
           coalesce(p.gp_override, p.avg_gp) as gp,
           date_part('year', age(p.birthdate))::int as age,
           t.sleeper_user_id as owner_id
    from players p left join teams t on t.id = p.team_id where p.id = ${playerId}`;
  if (!row || row.team_id !== viewer.teamId) return { error: "That player isn't on your team.", status: 403 };

  if (row.nba_experience === 0) return {error:"Rookies cannot sign extensions.", status:409};
  if (row.nba_experience == null) return {error:"NBA experience has not been synced for this player. Contact the commissioner.", status:409};
  const ownerKey = row.owner_id != null ? `sleeper:${row.owner_id}` : `team:${viewer.teamId}`;
  const [done] = await sql`select 1 from extensions where player_id = ${playerId} and contract_version = ${row.contract_version}
    and (accepted or owner_key = ${ownerKey})`;
  if (done) return { error: "This contract has already been extended or your negotiation is closed. A new contract signed in free agency restores eligibility.", status: 409 };

  const window = getSalaryYears();
  const contracts = await sql`
    select season, amount from contracts
    where player_id = ${playerId} and season = any(${window})`;
  const player: Player = { id: row.id, name: row.name, team: "", ppg: row.ppg, avg_gp: row.avg_gp, salaries: {} };
  for (const c of contracts) player.salaries[c.season] = Number(c.amount);
  const years = getExtensionYears(player);
  if (years.length === 0) return { error: "His contract already runs to the end of the window.", status: 400 };

  const age: number | null = row.age;
  if (row.fair_value == null || age == null) {
    return { error: "No value for this player yet — contact the commissioner to update.", status: 409 };
  }

  const [state] = await sql`
    select offers_used, best_ratio, last_average::float8 as last_average,
           demand::float8 as demand, demand_years
    from extension_negotiations where player_id = ${playerId} and owner_key = ${ownerKey} and contract_version = ${row.contract_version}`;
  return {
    player,
    years,
    age,
    fairValue: row.fair_value,
    ownerKey,
    contractVersion: row.contract_version,
    stats: {
      fairValue: row.fair_value,
      age,
      ppg: Math.round((row.ppg ?? row.proj_fppg ?? 0) * 10) / 10,
      avgGamesPlayed: row.gp != null ? Math.round(row.gp) : null,
    },
    state: (state as Extract<Loaded, { player: Player }>["state"]) ?? null,
  };
}

function view(l: Extract<Loaded, { player: Player }>) {
  const { seed, ...opening } = openingFor(l);
  return {
    opening,
    stats: l.stats,
    years: l.years,
    offersUsed: l.state?.offers_used ?? 0,
    lastAverage: l.state?.last_average ?? 0,
    demand: l.state?.demand != null ? {
      amount: l.state.demand,
      years: l.state.demand_years,
      reply: finalDemandLine(opening.tier, l.state.demand, l.state.demand_years?.length ?? 1, seed + l.state.offers_used),
    } : null,
  };
}

function openingFor(l: Extract<Loaded, { player: Player }>) {
  return extensionOpening(l.ownerKey, l.player.id, getSalaryYears()[0], l.fairValue, l.age, l.years);
}

export async function GET(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return notLoggedIn();
  const l = await load(viewer, Number(request.nextUrl.searchParams.get("player_id")));
  if ("error" in l) return Response.json({ error: l.error }, { status: l.status });
  return Response.json(view(l), { headers: { "Cache-Control": "private, no-store" } });
}

async function sign(viewer: Viewer, l: Extract<Loaded, {player:Player}>, years: number[], amounts: Record<number, number>, accepted: boolean) {
  await sql`select byf_extension_finish(${l.player.id}::int, ${viewer.teamId}::int, ${l.ownerKey}, ${l.contractVersion}::int, ${years}::int[],
    ${JSON.stringify(amounts)}::jsonb, ${accepted}::boolean, ${l.state?.offers_used ?? 0}::int)`;
}

export async function POST(request: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return notLoggedIn();
  const body = (await request.json().catch(() => null)) as
    | { player_id?: number; action?: string; years?: number[]; amounts?: Record<string, number> }
    | null;
  if (!body || !Number.isSafeInteger(body.player_id)) return Response.json({ error: "Choose a player." }, { status: 400 });

  const l = await load(viewer, body.player_id!);
  if ("error" in l) return Response.json({ error: l.error }, { status: l.status });
  const playerId = l.player.id;
  const used = l.state?.offers_used ?? 0;
  const { tier, seed } = openingFor(l);

  // Answering the final demand.
  if (body.action === "accept" || body.action === "decline") {
    if (l.state?.demand == null || !l.state.demand_years) {
      return Response.json({ error: "There's no final demand to answer." }, { status: 400 });
    }
    const years = l.state.demand_years;
    const amounts = Object.fromEntries(years.map((y) => [y, body.action === "accept" ? l.state!.demand! : 0]));
    try { await sign(viewer, l, years, amounts, body.action === "accept"); }
    catch (error) { return adminError(error); }
    await audit(viewer, body.action === "accept" ? "extension_signed" : "extension_rejected", { player: l.player.name, amounts });
    return Response.json({
      done: true,
      accepted: body.action === "accept",
      reply: dialogueLine(tier, body.action === "accept" ? "accepted" : "declined", seed + used),
      final: { years, amounts },
    });
  }

  if (body.action !== "offer") return Response.json({ error: "Unknown action." }, { status: 400 });
  if (l.state?.demand != null) return Response.json({ error: "Answer his final demand first." }, { status: 400 });
  if (used >= MAX_OFFERS) return Response.json({ error: "You're out of offers." }, { status: 400 });

  const years = [...(body.years ?? [])].map(Number).sort((a, b) => a - b);
  const amounts: Record<number, number> = {};
  for (const y of years) amounts[y] = Number(body.amounts?.[y]);
  const problem = offerProblem(years, amounts, l.years);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const average = years.reduce((s, y) => s + amounts[y], 0) / years.length;
  if (used > 0 && average < (l.state?.last_average ?? 0)) {
    return Response.json({ error: "You can't lower your offer." }, { status: 400 });
  }

  const fairValue = fairValuePrice(l.fairValue, l.age, years);
  const ratio = average / fairValue.average;
  const insulting = isInsulting(ratio);
  const nowUsed = used + (insulting ? 2 : 1);
  const bestRatio = Math.max(l.state?.best_ratio ?? 0, ratio);
  const answer = respond(ratio, nowUsed, fairValue.snapped, tier, seed + nowUsed);

  if (answer.accepted) {
    try { await sign(viewer, l, years, amounts, true); }
    catch (error) { return adminError(error); }
    await audit(viewer, "extension_signed", { player: l.player.name, amounts });
    return Response.json({ done: true, accepted: true, reply: answer.reply, offersUsed: nowUsed, final: { years, amounts } });
  }

  let demand: { amount: number; years: number[] } | null = null;
  let reply = answer.reply;
  if (nowUsed >= MAX_OFFERS) {
    const u = ultimatum(fairValue, bestRatio, years.length, tier, seed + nowUsed);
    demand = { amount: u.amount, years };
    reply = u.reply;
  }
  // Only advance if nobody else moved this negotiation since we read it.
  const saved = await sql`
    insert into extension_negotiations (player_id, team_id, owner_key, contract_version, offers_used, best_ratio, last_average, demand, demand_years)
    select ${playerId}, ${viewer.teamId}, ${l.ownerKey}, ${l.contractVersion}, ${nowUsed}, ${bestRatio}, ${Math.round(average)}, ${demand?.amount ?? null}, ${demand?.years ?? null}
    where not exists(select 1 from extensions e where e.player_id = ${playerId} and e.contract_version = ${l.contractVersion} and (e.accepted or e.owner_key = ${l.ownerKey}))
      and exists(select 1 from players p join teams t on t.id = p.team_id
        where p.id = ${playerId} and p.team_id = ${viewer.teamId} and p.nba_experience > 0 and p.contract_version = ${l.contractVersion}
          and coalesce('sleeper:' || t.sleeper_user_id, 'team:' || t.id) = ${l.ownerKey})
    on conflict (player_id, contract_version, owner_key) do update set
      offers_used = excluded.offers_used, best_ratio = excluded.best_ratio, last_average = excluded.last_average,
      demand = excluded.demand, demand_years = excluded.demand_years, updated_at = now()
    where extension_negotiations.offers_used = ${used}
    returning player_id`;
  if (saved.length === 0) return Response.json({ error: "This negotiation changed in another tab. Reload it." }, { status: 409 });

  return Response.json({ done: false, accepted: false, reply, offersUsed: nowUsed, demand, insulting });
}

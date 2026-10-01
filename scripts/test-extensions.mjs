import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";

function load(path, dependencies = {}) {
  const source = fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert(name in dependencies, `Unmocked dependency: ${name}`);
    return dependencies[name];
  }, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

const types = load("src/lib/types.ts");
const dialogue = load("src/lib/extension-dialogue.ts", { "./types": types });
const extensions = load("src/lib/extensions.ts", { "./types": types, "./extension-dialogue": dialogue });
const { extensionOpening } = load("src/lib/extension-opening.ts", {
  "node:crypto": { createHash }, "./types": types, "./extensions": extensions, "./extension-dialogue": dialogue,
});
const season = types.getSalaryYears()[0];
const years = types.getSalaryYears().slice(1);
let count = 0;
async function test(name, run) { await run(); count++; console.log(`PASS ${name}`); }

await test("$5M uplift wins below $16.67M; 30% uplift wins above it", () => {
  assert.equal(extensions.askingPrice(10, 30, [season]).average, 15_000_000);
  assert.equal(extensions.askingPrice(20, 30, [season]).average, 26_000_000);
  assert.equal(extensions.askingPrice(0, 30, [season]).average, 5_000_000);
  assert.equal(extensions.askingPrice(-10, 30, [season]).average, 5_000_000);
});
await test("future-season inflation is applied before the uplift, with caps and minimums", () => {
  const ask = extensions.askingPrice(20, 30, years);
  for (const year of years) assert.equal(ask.perYear[year], Math.round(types.getFairValueForYear(20, year) * 1_000_000 * 1.3));
  assert.equal(extensions.askingPrice(50, 23, [season]).average, 60_000_000);
  assert.equal(extensions.askingPrice(70, 24, [season]).average, 80_000_000);
  assert(extensions.askingPrice(50, 23, [season]).snapped);
  assert.equal(extensions.askingPrice(0, 30, [season + 20]).average, types.getVetMin(season + 20));
});
await test("all six tier boundaries, including capped-player priority", () => {
  const tier = (value, age = 30) => dialogue.extensionTier(value, extensions.askingPrice(value, age, [season]), season);
  for (const [value, expected] of [[0, "minimum"], [4.999, "minimum"], [5, "bench"], [9.999, "bench"], [10, "rotation"], [19.999, "rotation"], [20, "starter"], [39.999, "starter"], [40, "star"], [62, "max"]]) assert.equal(tier(value), expected);
  assert.equal(tier(47, 23), "max");
  assert.equal(tier(47, 24), "star");
});
await test("switching players, sessions, or devices cannot reroll an owner/player opening", () => {
  const first = extensionOpening("sleeper:owner", 12, season, 20, 30, years);
  for (let i = 0; i < 100; i++) {
    extensionOpening("sleeper:owner", i + 100, season, 20, 30, years);
    assert.deepEqual(extensionOpening("sleeper:owner", 12, season, 20, 30, years), first);
  }
  // Shortening the offered term does not reroll the reveal either.
  const short = extensionOpening("sleeper:owner", 12, season, 20, 30, years.slice(0, 1));
  assert.equal("askingPrice" in short, "askingPrice" in first);
});
await test("20% reveal probability, with varied greetings and independent owner accounts", () => {
  let reveals = 0, different = 0;
  const greetings = new Set();
  for (let i = 0; i < 10_000; i++) {
    const opening = extensionOpening(`sleeper:${i}`, 12, season, 20, 30, years);
    const other = extensionOpening(`sleeper:${i}`, 13, season, 20, 30, years);
    if ("askingPrice" in opening) reveals++;
    if (opening.text !== other.text) different++;
    greetings.add(opening.text.split(". ")[0]);
  }
  assert(reveals > 1850 && reveals < 2150, `${reveals}/10000 reveals`);
  assert(different > 7000);
  assert(greetings.size >= 6);
  console.log(`  ${reveals}/10000 owner accounts received an asking-price reveal`);
});
await test("offer acceptance, max demands, insults and final-demand caps still work", () => {
  assert(!extensions.respond(.94, 1, false, "minimum").accepted);
  assert(extensions.respond(.95, 1, false, "minimum").accepted);
  assert(!extensions.respond(.98, 1, true, "max").accepted);
  assert(extensions.respond(1, 1, true, "max").accepted);
  assert(extensions.isInsulting(.39));
  assert(!extensions.isInsulting(.4));
  const ask = extensions.askingPrice(100, 23, years);
  assert.equal(extensions.ultimatum(ask, .5, years.length, "max").amount, 60_000_000);
  assert(!dialogue.dialogueLine("minimum", "declined", 0).includes("replacing me"));
});

// Exercise the real route with in-memory auth/SQL. Never connect to a database.
let viewer = { sessionId: "device-one", teamId: 7, teamName: "Team", role: null };
let playerTeam = 7;
let playerId = 12;
let storedState = null;
const fakeSql = async (parts) => {
  const query = parts.join("?");
  if (query.includes("from players p")) return [{ id: playerId, name: "Player", team_id: playerTeam, ppg: 15, avg_gp: 65, proj_fppg: 17, fair_value: 20, age: 30, gp: 65, owner_id: "owner" }];
  if (query.includes("select 1 from extensions")) return [];
  if (query.includes("from contracts")) return [{ season, amount: 10_000_000 }];
  if (query.includes("from extension_negotiations")) return storedState ? [storedState] : [];
  if (query.includes("insert into extension_negotiations")) return [{ player_id: playerId }];
  throw new Error(`Unexpected SQL: ${query}`);
};
fakeSql.transaction = async () => { throw new Error("Unexpected signing transaction"); };
const route = load("src/app/api/extensions/negotiate/route.ts", {
  "@/lib/db": { sql: fakeSql },
  "@/lib/auth": { getViewer: async () => viewer, notLoggedIn: () => Response.json({ error: "login" }, { status: 401 }), audit: async () => {} },
  "@/lib/extensions": extensions, "@/lib/types": types,
  "@/lib/extension-opening": { extensionOpening }, "@/lib/extension-dialogue": dialogue,
});
const get = () => route.GET({ nextUrl: new URL(`http://test/api/extensions/negotiate?player_id=${playerId}`) });
await test("GET never leaks a hidden ask or seed; reveal and restore survive device changes", async () => {
  for (playerId = 1; playerId <= 50; playerId++) {
    const response = await get();
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    const first = await response.json();
    assert.equal(first.opening.seed, undefined);
    const expected = extensionOpening("sleeper:owner", playerId, season, 20, 30, years);
    assert.equal("askingPrice" in first.opening, "askingPrice" in expected);
    viewer.sessionId = "device-two";
    assert.deepEqual(await (await get()).json(), first);
  }
  storedState = { offers_used: 3, best_ratio: .7, last_average: 20_000_000, demand: 35_000_000, demand_years: years };
  const restored = await (await get()).json();
  assert.equal(restored.offersUsed, 3);
  assert.equal(restored.demand.amount, 35_000_000);
  assert.equal(restored.demand.reply, dialogue.finalDemandLine(restored.opening.tier, 35_000_000, years.length, extensionOpening("sleeper:owner", playerId, season, 20, 30, years).seed + 3));
  storedState = null;
});
await test("an unauthenticated or different owner cannot load a negotiation", async () => {
  const owner = viewer;
  viewer = null;
  assert.equal((await get()).status, 401);
  viewer = owner;
  playerTeam = 8;
  assert.equal((await get()).status, 403);
  playerTeam = 7;
});
await test("POST judges an offer against the raised ask rather than the old fair value", async () => {
  const response = await route.POST({ json: async () => ({ player_id: playerId, action: "offer", years: years.slice(0, 1), amounts: { [years[0]]: 21_000_000 } }) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.accepted, false);
  assert.equal(result.offersUsed, 1);
  assert.equal(result.demand, null);
});
console.log(`${count} extension checks passed; no database writes.`);

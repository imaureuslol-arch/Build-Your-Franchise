import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

function load(file, dependencies = {}) {
  const source = fs.readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((key) => dependencies[key], module, module.exports);
  return module.exports;
}
const types = load("types"), aging = load("aging");
const { projectFppg, futureTeamPower, toRating } = load("team-projection", { "./aging": aging });
const { valuePicks, YEARLY_DISCOUNT, rookieScale, HISTORICAL_CURVE } = load("pick-value", { "./types": types });
const current = { Veterans: 100, Youth: 80, Middle: 1 };
const rosters = [
  ...[41, 38, 38, 31, 32].map((age) => ({ team: "Veterans", age, fppg: 50 })),
  ...Array.from({ length: 8 }, () => ({ team: "Youth", age: 23, fppg: 27 })),
  ...Array.from({ length: 8 }, () => ({ team: "Middle", age: 28, fppg: 18 })),
];
const years = [2027, 2028, 2029, 2030];
const forecast = futureTeamPower(rosters, current, 2027, years);
const ids = new Map([[1, "Veterans"], [2, "Youth"], [3, "Middle"]]);
const pick = (year, round = 1, original = 1, owner = "Veterans") => ({ id: types.pickPlayerId(year, round, original), name: `${year} pick`, team: owner, salaries: {}, ppg: null, avg_gp: null });
let count = 0;
function test(name, run) { run(); count++; console.log(`PASS ${name}`); }
test("current PWR is preserved; old contender becomes weaker by 2030", () => {
  assert.deepEqual(forecast[2027], current);
  assert(forecast[2030].Veterans < forecast[2030].Middle);
  assert(forecast[2030].Veterans < forecast[2030].Youth);
  assert.equal(forecast[2030].Veterans, 1);
});
test("future slot uses that year's projection, not today's contender rank", () => {
  const picks = years.map((y) => pick(y));
  const values = valuePicks(picks, current, ids, 2027, undefined, forecast);
  assert.equal(values[picks[0].id].slot, 3);
  assert.equal(values[picks[3].id].slot, 1);
  assert.equal(values[picks[3].id].currentSlot, 3);
  assert.equal(values[picks[3].id].power, 1);
  assert.equal(values[picks[3].id].currentPower, 100);
  const frozen = valuePicks([picks[3]], current, ids, 2027);
  assert(values[picks[3].id].fairValue > frozen[picks[3].id].fairValue);
});
test("20% annual distance discount: 100%, 80%, 64%, 51.2%", () => {
  const picks = years.map((y) => pick(y));
  const values = valuePicks(picks, current, ids, 2027, { A: 10, k: 0 }, forecast);
  assert.equal(YEARLY_DISCOUNT, .8);
  assert.deepEqual(picks.map((p) => values[p.id].fairValue), [10, 8, 6.4, 5.1]);
  assert(Math.abs(values[picks[3].id].discount - .512) < 1e-9);
});
test("retirement risk compounds, without declaring an active player retired now", () => {
  const old = { team: "Veterans", fppg: 50, age: 41 };
  assert.equal(projectFppg(old, 0), 50);
  assert(projectFppg(old, 3) < 50 * .9 ** 3);
  assert(projectFppg({ ...old, age: 23 }, 3) > 50);
  assert.equal(projectFppg({ ...old, age: null }, 3), 50);
});
test("young bench replaces fading starters when lineups are re-ranked", () => {
  const starters = Array.from({ length: 8 }, () => ({ team: "Veterans", age: 41, fppg: 50 }));
  const bench = Array.from({ length: 8 }, () => ({ team: "Veterans", age: 22, fppg: 25 }));
  const rival = Array.from({ length: 8 }, () => ({ team: "Youth", age: 28, fppg: 20 }));
  const powers = { Veterans: 100, Youth: 1 };
  assert.equal(futureTeamPower([...starters, ...rival], powers, 2027, [2030])[2030].Veterans, 1);
  assert.equal(futureTeamPower([...starters, ...bench, ...rival], powers, 2027, [2030])[2030].Veterans, 100);
});
test("traded picks project the original team, regardless of owner", () => {
  const a = pick(2030), b = pick(2030, 1, 1, "Youth");
  assert.deepEqual(valuePicks([a], current, ids, 2027, undefined, forecast), valuePicks([b], current, ids, 2027, undefined, forecast));
});
test("round two keeps its overall-slot offset and rookie scale", () => {
  const p = pick(2030, 2);
  const value = valuePicks([p], current, ids, 2027, undefined, forecast)[p.id];
  assert.equal(value.slot, 4); assert.equal(value.salary, rookieScale(4));
});
test("next draft's historical value model remains unchanged", () => {
  const p = pick(2027), value = valuePicks([p], current, ids, 2027, undefined, forecast)[p.id];
  const V = (slot) => HISTORICAL_CURVE.A * Math.exp(-HISTORICAL_CURVE.k * (slot - 1));
  const expected = .7 * V(3) + .3 * (V(1) + V(2) + V(3)) / 3;
  assert.equal(value.fairValue, Math.round(expected * 10) / 10);
  assert.equal(value.discount, 1);
});
test("uncertainty keeps decreasing beyond the three usual drafts", () => {
  const picks = [pick(2029), pick(2030), pick(2031)];
  const values = valuePicks(picks, current, ids, 2027);
  assert(values[picks[0].id].certainty > values[picks[1].id].certainty);
  assert(values[picks[1].id].certainty > values[picks[2].id].certainty);
});
test("empty/equal-strength leagues produce safe, finite forecasts", () => {
  assert.deepEqual(valuePicks([], {}, new Map(), 2027), {});
  assert.deepEqual(futureTeamPower([], {}, 2027, years)[2030], {});
  assert.deepEqual(Object.fromEntries(toRating(new Map([["A", 0], ["B", 0]]))), { A: 50, B: 50 });
});
console.log(`${count} pick projection checks passed.`);

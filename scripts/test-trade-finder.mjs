import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

// Load the pure TS engine without a server, database or extra test dependency.
function load(file, dependencies = {}) {
  const source = fs.readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((key) => dependencies[key], module, module.exports);
  return module.exports;
}
const types = load("types");
const { findTrades, matchesRule } = load("trade-finder", { "./types": types });
const year = types.getCurrentSeasonYear();
const p = (id, team, salary, ppg = 20) => ({ id, team, name: `Player ${id}`, salaries: { [year]: salary * 1e6 }, ppg, avg_gp: 70 });
const outgoing = p(1, "A", 20);
const youngLow = p(2, "B", 10, 10), oldHigh = p(3, "B", 10, 30), youngHigh = p(4, "B", 10, 20);
const info = { 1: { fairValue: 20, age: 28, positions: ["SF"] }, 2: { fairValue: 10, age: 22, positions: ["PG"] }, 3: { fairValue: 10, age: 30, positions: ["C"] }, 4: { fairValue: 10, age: 24, positions: ["PG", "SG"] } };
const rule = { id: 1, count: 1, position: "any", ageUnder: 25, fppgOver: 15 };
const filters = { playersMin: 2, playersMax: 2, picksMin: 0, picksMax: 0, pickRound: "any", salaryMax: 30e6, valueTolerance: .25, rules: [rule], sort: "value" };
function search(players, picks = [], overrides = {}, pickValues = {}, scouts = info, offer = [outgoing]) {
  const iterator = findTrades(players, picks, scouts, pickValues, "A", offer, { ...filters, ...overrides });
  let step;
  do { step = iterator.next(); } while (!step.done);
  return step.value;
}
let tests = 0;
function test(name, run) { run(); tests++; console.log(`PASS ${name}`); }
test("age and FPPG must match the same player", () => assert.equal(search([outgoing, youngLow, oldHigh]).length, 0));
test("two players with one young productive player under $30M", () => {
  const result = search([outgoing, youngLow, oldHigh, youngHigh]);
  assert.equal(result.length, 2); assert(result.every((r) => r.assets.length === 2 && r.assets.some((a) => a.id === 4)));
});
test("strict under-age, over-FPPG and under-budget boundaries", () => {
  assert.equal(matchesRule(youngHigh, { ...info[4], age: 25 }, rule), false);
  assert.equal(matchesRule({ ...youngHigh, ppg: 15 }, info[4], rule), false);
  assert.equal(search([outgoing, p(2, "B", 15), p(4, "B", 15)]).length, 0);
});
test("Sleeper multi-position eligibility and unknown data", () => {
  assert.equal(matchesRule(youngHigh, info[4], { ...rule, position: "SG" }), true);
  assert.equal(matchesRule(youngHigh, info[4], { ...rule, position: "C" }), false);
  assert.equal(matchesRule(youngHigh, undefined, rule), false);
  assert.equal(matchesRule({ ...youngHigh, ppg: null }, info[4], rule), false);
});
const first = { id: types.pickPlayerId(year + 1, 1, 2), name: `${year + 1} 1st (B)`, team: "B", salaries: {}, ppg: null, avg_gp: null };
const second = { ...first, id: types.pickPlayerId(year + 1, 2, 2), name: `${year + 1} 2nd (B)` };
const pickValues = { [first.id]: { fairValue: 20 }, [second.id]: { fairValue: 10 } };
test("pick-only packages count picks separately and cost zero", () => {
  const results = search([outgoing, youngHigh], [first, second], { playersMin: 0, playersMax: 0, picksMin: 1, picksMax: 1, rules: [] }, pickValues);
  assert.equal(results.length, 1); assert.equal(results[0].assets[0].id, first.id); assert.equal(results[0].salary, 0); assert.equal(results[0].value, 20);
});
test("mixed player/pick valuation and round filter", () => {
  const overrides = { playersMin: 1, playersMax: 1, picksMin: 1, picksMax: 1, rules: [], pickRound: "2" };
  const results = search([outgoing, youngHigh], [first, second], overrides, pickValues);
  assert.equal(results.length, 1); assert.equal(results[0].value, 20); assert.equal(results[0].salary, 10e6);
  assert(results[0].assets.some((a) => a.id === second.id));
});
test("picks cannot satisfy player requirements", () => assert.equal(search([outgoing], [first], { playersMin: 0, playersMax: 0, picksMin: 1, picksMax: 1 }, pickValues).length, 0));
test("both cap statuses include dead cap", () => {
  const candidate = p(4, "B", 10);
  const dead = { ...p(-2, "B", 250), name: "Dead Cap" };
  assert.equal(search([outgoing, candidate, dead], [], { playersMin: 1, rules: [], valueTolerance: null }).length, 0);
  const ownDead = { ...dead, id: -1, team: "A" };
  const equalSalary = p(4, "B", 20);
  assert.equal(search([outgoing, equalSalary, ownDead], [], { playersMin: 1, rules: [], valueTolerance: null }).length, 0);
  assert.equal(search([outgoing, candidate, ownDead], [], { playersMin: 1, rules: [], valueTolerance: null }).length, 1);
});
test("soft-cap teams match salary but cannot increase it", () => {
  const dead = { ...p(-1, "A", types.getSoftCap() / 1e6 - 19), name: "Dead Cap" };
  const overrides = { playersMin: 1, rules: [], valueTolerance: null, salaryMax: null };
  assert.equal(search([outgoing, p(4, "B", 20), dead], [], overrides).length, 1);
  assert.equal(search([outgoing, p(4, "B", 21), dead], [], overrides).length, 0);
});
test("missing valuations and empty offers are excluded", () => {
  assert.equal(search([outgoing, p(9, "B", 5)], [], { playersMin: 1, rules: [], valueTolerance: null }).length, 0);
  assert.equal(search([outgoing, youngHigh], [], {}, {}, info, []).length, 0);
});
test("top 50 includes later teams; search yields progress", () => {
  const many = Array.from({ length: 70 }, (_, i) => p(100 + i, i === 69 ? "Z" : "B", 1));
  const scouts = { ...info };
  many.forEach((a, i) => scouts[a.id] = { fairValue: i === 69 ? 20 : 10, age: 24, positions: ["PG"] });
  const result = search([outgoing, ...many], [], { playersMin: 1, playersMax: 1, rules: [], valueTolerance: null }, {}, scouts);
  assert.equal(result.length, 50); assert.equal(result[0].team, "Z");
  const generator = findTrades([outgoing, ...many], [], scouts, {}, "A", [outgoing], { ...filters, rules: [], valueTolerance: null });
  assert.equal(generator.next().done, false);
});
test("every incoming player appears at most five times across different packages", () => {
  const watson = {...p(200,"B",1,100),name:"Peyton Watson"};
  const partners = Array.from({length:70},(_,i)=>p(201+i,"B",1,20));
  const scouts = {...info};
  for (const player of [watson,...partners]) scouts[player.id]={fairValue:10,age:23,positions:["SF"]};
  const result = search([outgoing,watson,...partners],[],{playersMin:2,playersMax:2,rules:[],valueTolerance:null,sort:"fppg"},{},scouts);
  assert.equal(result.filter(r=>r.assets.some(a=>a.id===watson.id)).length,5);
  assert.equal(result.length,50);
  const counts = new Map();
  for (const match of result) for (const asset of match.assets) counts.set(asset.id,(counts.get(asset.id)??0)+1);
  assert([...counts.values()].every(count=>count<=5));
});
test("the same player package with different picks appears only once, using the best-ranked offer", () => {
  const extra = {...second,id:types.pickPlayerId(year+2,2,2),name:`${year+2} 2nd (B)`};
  const values = {...pickValues,[extra.id]:{fairValue:9}};
  const overrides = {playersMin:2,playersMax:2,picksMin:1,picksMax:1,rules:[],valueTolerance:null,sort:"value"};
  const result = search([outgoing,youngHigh,oldHigh],[first,second,extra],overrides,values);
  assert.equal(result.length,1);
  assert(result[0].assets.some(a=>a.id===extra.id));
});
console.log(`${tests} Trade Finder checks passed.`);

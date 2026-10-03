import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

// All writes use a disposable database. Never mutate the production league.
if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
const admin = neon(process.env.DATABASE_URL);
const database = 'byf_cap_test_' + Date.now();
assert.match(database, /^byf_cap_test_\d+$/);
await admin.query('create database ' + database);
const scoped = new URL(process.env.DATABASE_URL); scoped.pathname = '/' + database;
const sql = neon(scoped.toString());
let checks = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const reject = async (fn, pattern) => { await assert.rejects(fn, pattern); checks++; };
const clock = async time => sql`update fixture_clock set stamp=${time}::timestamptz`;
const status = async team => (await sql`select *,payroll::float8 from team_cap_status where team_id=${team}`)[0];
const enforce = async () => (await sql`select byf_enforce_hard_cap() result`)[0].result;
const contract = async player => (await sql`select jsonb_build_object('teamId',p.team_id,'contractVersion',p.contract_version,'contracts',coalesce(
  (select jsonb_object_agg(season::text,amount) from contracts where player_id=p.id and season>=byf_cap_season(byf_cap_clock())),'{}')) state
  from players p where id=${player}`)[0].state;
const waive = async player => {
  const expected = await contract(player);
  const [rule] = await sql`select byf_cap_season(byf_cap_clock()) season,byf_cap_in_season(byf_cap_clock()) active`;
  const body = {playerId:player,expected,expectedSeason:rule.season,
    expectedDeadCap:rule.active ? Math.round((expected.contracts[rule.season] ?? 0)/2) : 0};
  return (await sql`select byf_waive_player(${JSON.stringify(body)}::jsonb,null::uuid,null::int) result`)[0].result;
};
function load(path, deps={}) {
  const code = ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',code)(name=>{assert(name in deps,'Missing dependency '+name);return deps[name];},mod,mod.exports);
  return mod.exports;
}
const originalFetch=globalThis.fetch;
try {
  equal((await sql`select current_database() db`)[0].db,database);
  const base=readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8');
  await sql.transaction(base.split(/;\s*(?:\r?\n|$)/).filter(s=>s.trim()).map(s=>sql.query(s)));
  for (const file of readdirSync(new URL('../db/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()) {
    const migration=readFileSync(new URL('../db/migrations/'+file,import.meta.url),'utf8');
    await sql.transaction(migration.split(/\r?\n-- statement\r?\n/).filter(s=>s.trim()).map(s=>sql.query(s)));
    if (file==='012-seasonal-cap-waivers.sql') {
      await sql.transaction(migration.split(/\r?\n-- statement\r?\n/).filter(s=>s.trim()).map(s=>sql.query(s)));
    }
  }
  // Replace only the clock in this isolated database to test real boundary behavior.
  await sql`create table fixture_clock(stamp timestamptz)`;
  await sql`insert into fixture_clock values('2026-10-03T12:00:00Z')`;
  await sql.query("create or replace function byf_cap_clock() returns timestamptz language sql volatile as $$ select stamp from fixture_clock $$");
  for (const [time,active] of [
    ['2026-10-14T23:59:59+03:00',false],['2026-10-15T00:00:00+03:00',true],
    ['2027-01-01T00:00:00+02:00',true],['2027-03-30T23:59:59+03:00',true],
    ['2027-03-31T00:00:00+03:00',false],['2027-04-01T00:00:00+03:00',false],
    ['2027-10-15T00:00:00+03:00',true],
  ]) equal((await sql`select byf_cap_in_season(${time}::timestamptz) active`)[0].active,active);
  await sql`insert into teams(id,name,sleeper_roster) values(1,'Offseason',1),(2,'Enforced',2),(3,'Reset',3),(4,'Dead cap only',4)`;
  await sql`insert into players(id,name,team_id,sleeper_id,fair_value) values
    (1,'Offseason waiver',1,'s1',1),(20,'Lowest value',2,'s20',1),(21,'Next value',2,'s21',2),
    (22,'Best value',2,'s22',100),(30,'Reset contract',3,'s30',10),(31,'Manual waiver',3,'s31',11)`;
  await sql`insert into contracts values(1,2026,1000000),(1,2027,12000000),(1,2028,18000000),
    (20,2027,10000000),(20,2028,30000000),(21,2027,20000000),(22,2027,30000000),
    (30,2027,250000000),(31,2027,10000000),(31,2028,20000000)`;
  await sql`insert into dead_cap(team_id,label,season,amount) values(2,'Existing',2027,210000000),(4,'Unavoidable',2027,250000000)`;
  equal((await status(2)).deadline,null);
  equal((await enforce()).waived,[]);
  const off=await waive(1);
  equal(off.deadCap,0); equal(off.payroll,0);
  equal((await sql`select team_id from players where id=1`)[0].team_id,null);
  equal((await sql`select season from contracts where player_id=1 order by season`).map(r=>r.season),[2026]);
  await reject(()=>waive(1),/no longer on a team/);
  equal((await sql`select count(*)::int n from player_waivers where player_id=1`)[0].n,1);

  await clock('2026-10-15T00:02:00+03:00'); await enforce();
  const original=(await status(2)).deadline;
  equal(Date.parse(original),Date.parse('2026-10-25T00:00:00+03:00'));
  await clock('2026-10-16T12:00:00+03:00');
  await sql`update contracts set amount=31000000 where player_id=22 and season=2027`;
  equal((await status(2)).deadline,original);
  await sql.transaction([
    sql`update contracts set amount=1000000 where player_id=30 and season=2027`,
    sql`update contracts set amount=250000000 where player_id=30 and season=2027`,
  ]);
  equal((await status(3)).deadline,original);
  await sql`update contracts set amount=220000000 where player_id=30 and season=2027`;
  equal((await status(3)).deadline,null);
  await clock('2026-10-17T12:00:00+03:00');
  await sql`update contracts set amount=250000000 where player_id=30 and season=2027`;
  equal(Date.parse((await status(3)).deadline),Date.parse('2026-10-27T12:00:00+03:00'));
  await sql`update contracts set amount=200000000 where player_id=30 and season=2027`;
  await sql`update contracts set amount=30000000 where player_id=22 and season=2027`;
  const stale=await contract(31);
  await sql`update contracts set amount=12000000 where player_id=31 and season=2027`;
  await reject(()=>sql`select byf_waive_player(${JSON.stringify({playerId:31,expected:stale,expectedSeason:2027,expectedDeadCap:5000000})}::jsonb,null,null)`,/contract changed/);
  await reject(async()=>sql`select byf_waive_player(${JSON.stringify({playerId:31,expected:await contract(31),expectedSeason:2027,expectedDeadCap:5000000})}::jsonb,null,null)`,/charge changed/);
  const trade=(await sql`insert into trades(status,season,proposed_by) values('proposed',2027,3) returning id`)[0].id;
  await sql`insert into trade_items(trade_id,player_id,from_team,to_team) values(${trade},31,3,1)`;
  const manual=await waive(31);
  equal(manual.deadCap,6000000);
  equal((await sql`select season,amount::float8 amount from dead_cap where label='Waived: Manual waiver'`),[{season:2027,amount:6000000}]);
  equal((await sql`select count(*)::int n from contracts where player_id=31 and season>=2027`)[0].n,0);
  equal((await sql`select status from trades where id=${trade}`)[0].status,'cancelled');

  await clock('2026-10-24T23:59:59+03:00'); equal((await enforce()).waived,[]);
  await clock('2026-10-25T00:00:00+03:00');
  const forced=await enforce();
  equal(forced.waived.map(p=>p.playerId),[20,21]);
  equal(forced.waived.map(p=>p.deadCap),[0,0]);
  equal((await status(2)).payroll,240000000); equal((await status(2)).deadline,null);
  equal((await sql`select team_id from players where id=22`)[0].team_id,2);
  equal((await sql`select count(*)::int n from contracts where player_id in (20,21)`)[0].n,0);
  equal(forced.unresolved.map(t=>t.teamId),[4]);
  equal((await enforce()).waived,[]);
  equal((await sql`select count(*)::int n from audit_log where action='player_waived'`)[0].n,4);
  equal((await sql`select byf_cap_release_preview(3,2027) drops`)[0].drops,[]);
  // Preview is the same ordered set the enforcer will release, not salary rank.
  await sql`insert into teams(id,name,sleeper_roster,sleeper_user_id) values(5,'Reminder team',5,'500'),(6,'Failed reminder',6,'600')`;
  await sql`insert into players(id,name,team_id,fair_value) values(60,'Reminder target',5,2),(61,'Failed target',6,1)`;
  await sql`insert into contracts values(60,2027,250000000),(61,2027,250000000)`;
  equal((await sql`select byf_cap_release_preview(5,2027) drops`)[0].drops.map(p=>p.name),['Reminder target']);
  const sent=[];
  const notis=load('src/lib/cap-notifications.ts',{'./db':{sql},'./types':load('src/lib/types.ts'),
    './sleeper-messages':{sendSleeperDm:async(...args)=>{sent.push(args);if(args[0]==='600')throw Error('Unconfirmed');}}});
  await clock('2026-10-26T00:00:00+03:00'); // nine days left for these new October 25 crossings
  await notis.sendCapWarnings(); equal(sent.length,0);
  await clock('2026-10-27T00:00:00+03:00');
  await notis.sendCapWarnings(); equal(sent.length,2);
  assert.match(sent[0][1],/8-day alert/);assert.match(sent[0][1],/Reminder target/); checks+=2;
  equal((await sql`select status from cap_notifications where team_id=6`)[0].status,'unconfirmed');
  await Promise.all([notis.sendCapWarnings(),notis.sendCapWarnings()]); equal(sent.length,2);
  await clock('2026-11-01T00:00:00+02:00');
  await notis.sendCapWarnings(); equal(sent.length,4);
  assert.match(sent[2][1],/3-day alert/); checks++;
  await clock('2026-11-03T00:00:00+02:00');
  await notis.sendCapWarnings(); equal(sent.length,6);
  assert.match(sent[4][1],/1-day alert/); checks++;
  await notis.sendCapWarnings(); equal(sent.length,6);
  await sql`update contracts set amount=230000000 where player_id=60 and season=2027`;
  equal((await status(5)).deadline,null);
  await clock('2026-11-04T12:00:00+02:00');
  await sql`update contracts set amount=250000000 where player_id=60 and season=2027`;
  await clock('2026-11-06T12:00:00+02:00');
  await notis.sendCapWarnings(); equal(sent.length,7); // a new episode gets its own 8-day alert
  // Restore below-cap state before exercising unrelated fixture sync.
  await sql`update contracts set amount=1000000 where player_id in(60,61)`;
  await sql`update players set team_id=null where id in(60,61)`;
  await clock('2026-10-25T00:00:00+03:00');

  // Test real sync functions against the disposable book and mocked public Sleeper rosters.
  let rosters=[{roster_id:1,owner_id:null,players:['s1']},{roster_id:2,owner_id:null,players:['s20','s21','s22']},
    {roster_id:3,owner_id:null,players:['s30','s31']},{roster_id:4,owner_id:null,players:[]}];
  globalThis.fetch=async (url,...args)=> {
    if (!String(url).startsWith('https://api.sleeper.app/v1')) return originalFetch(url,...args);
    const path=new URL(String(url)).pathname;
    if (path.endsWith('/rosters')) return Response.json(rosters);
    if (path.endsWith('/users')) return Response.json([]);
    if (path.endsWith('/players/nba')) return Response.json({s1:{full_name:'Offseason waiver',active:true,team:'BOS'}});
    return Response.json({});
  };
  const sync=load('src/lib/sleeper-sync.ts',{'./db':{sql},'./picks':{
    applyPicks:async()=>[],pickDifferences:async()=>[],seedPicks:async()=>{},sleeperPicks:async()=>[],
  },'./sleeper-conferences':{conferencesFromSleeper:()=>new Map()}});
  await sync.syncFromSleeper('fixture');
  await sync.applySleeperRosters('fixture',2027);
  equal((await sql`select team_id from players where id in(1,20,21,31)`).map(p=>p.team_id),[null,null,null,null]);
  equal((await sql`select count(*)::int n from sync_issues where kind='waived_on_site'`)[0].n,4);
  equal((await sql`select count(*)::int n from player_waivers`)[0].n,4);
  rosters=rosters.map(r=>({...r,players:r.players.filter(id=>!['s1','s20','s21','s31'].includes(id))}));
  await sync.checkRosters('fixture');
  equal((await sql`select count(*)::int n from player_waivers where sleeper_pending`)[0].n,0);
  // A fresh FA contract restores normal sync behavior, without reviving the waived contract.
  await sql.transaction([sql`update players set team_id=1,contract_version=contract_version+1 where id=20`,sql`insert into contracts values(20,2027,8000000)`]);
  rosters[0].players.push('s20');
  await sync.applySleeperRosters('fixture',2027);
  equal((await sql`select team_id from players where id=20`)[0].team_id,1);
  equal((await sql`select amount::float8 amount from contracts where player_id=20 and season=2027`)[0].amount,8000000);
  // A Sleeper-only drop gets the same seasonal penalty, once.
  rosters[0].players=[];
  await sync.applySleeperRosters('fixture',2027);
  equal((await sql`select amount::float8 amount from dead_cap where team_id=1 and label='Waived: Lowest value'`)[0].amount,4000000);
  await sync.applySleeperRosters('fixture',2027);
  equal((await sql`select count(*)::int n from player_waivers where player_id=20`)[0].n,2);

  // An FA signed and waived in the same round must be available for bidding again.
  await sql`insert into players(id,name,fair_value) values(50,'Repeat free agent',20)`;
  const fa=async (body,team=null)=>(await sql`select byf_fa_action(${JSON.stringify(body)}::jsonb,null::uuid,${team}::int,2027) result`)[0].result;
  const bid={action:'bid',roundId:1,playerId:50,years:[2027],amounts:{2027:10000000}};
  const signed=(await fa(bid,1)).offer;
  await sql`update fa_player_auctions set accepts_at=clock_timestamp()-interval '1 second' where player_id=50`;
  await fa({action:'award',roundId:1,playerId:50,offerId:signed.id});
  equal((await waive(50)).deadCap,5000000);
  equal((await sql`select count(*)::int n from fa_awards where player_id=50`)[0].n,0);
  equal((await sql`select count(*)::int n from fa_player_auctions where player_id=50`)[0].n,0);
  equal((await sql`select count(*)::int n from free_agent_offers where player_id=50`)[0].n,0);
  assert((await fa(bid,3)).offer.id); checks++;
  equal((await sql`select (detail->'freeAgencyBefore'->'award'->>'offer_id') as id from audit_log
    where action='player_waived' and (detail->'after'->>'playerId')::int=50`)[0].id,signed.id);

  await clock('2027-03-28T12:00:00+03:00');
  await sql`update contracts set amount=250000000 where player_id=30 and season=2027`;
  assert((await status(3)).deadline); checks++;
  await clock('2027-03-30T23:59:59+03:00');
  await sql`insert into players(id,name,team_id) values(51,'Last in-season waiver',1)`;
  await sql`insert into contracts values(51,2027,5000000),(51,2028,6000000)`;
  equal((await waive(51)).deadCap,2500000);
  await clock('2027-03-31T00:00:00+03:00');
  equal((await enforce()).waived,[]); equal((await status(3)).deadline,null);
  equal((await waive(30)).deadCap,0);
  await clock('2027-04-01T00:00:00+03:00'); await enforce();
  equal((await status(2)).payroll,0); // old one-year dead cap does not roll forward
  await sql`insert into contracts values(22,2028,260000000)`;
  equal((await status(2)).deadline,null);
  await clock('2027-10-15T00:01:00+03:00'); await enforce();
  equal(Date.parse((await status(2)).deadline),Date.parse('2027-10-25T00:00:00+03:00'));

  // Route boundary: only the two commissioner tiers can waive; callers cannot set the policy.
  let viewer=null, mutations=0;
  const route=load('src/app/api/commissioner/waive/route.ts',{
    '@/lib/db':{sql:async()=>{mutations++;return [{result:{ok:true}}];}},
    '@/lib/auth':{getViewer:async()=>viewer,isAnyCommish:v=>['commish','subcommish'].includes(v?.role),forbidden:()=>Response.json({}, {status:403})},
    '@/lib/admin-errors':load('src/lib/admin-errors.ts'),
  });
  const request=body=>new Request('http://test/api/commissioner/waive',{method:'POST',body:JSON.stringify(body)});
  const valid={playerId:22,expected:{teamId:2,contractVersion:1,contracts:{2028:260000000}},expectedSeason:2028,expectedDeadCap:130000000};
  equal((await route.POST(request(valid))).status,403);
  viewer={role:null,teamId:2}; equal((await route.POST(request(valid))).status,403); equal(mutations,0);
  viewer={role:'subcommish',teamId:null}; equal((await route.POST(request(valid))).status,200);
  viewer={role:'commish',teamId:null}; equal((await route.POST(request(valid))).status,200);
  equal((await route.POST(request({...valid,expectedDeadCap:-1}))).status,400); equal(mutations,2);
  console.log(`PASS: ${checks} cap/waiver assertions, including real transactional enforcement, sync and permissions.`);
} finally {
  globalThis.fetch=originalFetch;
  await admin.query('drop database '+database+' with (force)');
}

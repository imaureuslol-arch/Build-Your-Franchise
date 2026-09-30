import { neon } from '@neondatabase/serverless';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

// Tests use their own temporary database; no production league rows are read or written.
if (!process.env.DATABASE_URL) process.loadEnvFile(process.env.BYF_ENV_FILE ?? '.env.local');
const admin = neon(process.env.DATABASE_URL);
const schema = 'byf_test_' + Date.now();
assert.match(schema, /^byf_test_\d+$/);
await admin.query('create database ' + schema);
const scoped = new URL(process.env.DATABASE_URL);
scoped.pathname = '/' + schema;
const sql = neon(scoped.toString());
let keep = false;
let checks = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const action = async (body, team = null) => (await sql`select byf_fa_action(${JSON.stringify(body)}::jsonb, null::uuid, ${team}::int, 2027) as result`)[0].result;
const contract = async body => (await sql`select byf_contract_edit(${JSON.stringify(body)}::jsonb, null::uuid, null::int) as result`)[0].result;
const dead = async body => (await sql`select byf_dead_cap_edit(${JSON.stringify(body)}::jsonb, null::uuid, null::int) as result`)[0].result;
const rejects = async (fn, pattern) => { await assert.rejects(fn, pattern); checks++; };
try {
  equal((await sql`select current_database() as schema`)[0].schema, schema);
  const base = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  await sql.transaction(base.split(/;\s*(?:\r?\n|$)/).filter(s => s.trim()).map(s => sql.query(s)));
  const migration = readFileSync(new URL('../db/migrations/001-commissioner-free-agency.sql', import.meta.url), 'utf8');
  const migrate = () => sql.transaction(migration.split(/\r?\n-- statement\r?\n/).map(s => sql.query(s)));
  await migrate(); await migrate();
  equal((await sql`select count(*)::int as n from fa_rounds`)[0].n, 1);
  await sql`insert into teams(id, name, owner_name) values(1, 'Test Alpha', 'Alpha'), (2, 'Test Beta', 'Beta'), (3, 'Test Over Cap', 'Over')`;
  await sql`insert into players(id, name, team_id, ppg, avg_gp, birthdate) values
    (1, 'Test Free Agent', null, 20, 60, '2000-01-01'), (2, 'Test Tied Player', null, 15, 60, '2000-01-01'),
    (3, 'Test Pending Player', null, 12, 60, '2000-01-01'), (4, 'Test Other Player', null, 10, 60, '2000-01-01'),
    (10, 'Test Contract Player', 1, 18, 60, '2000-01-01'), (11, 'Test Expensive Player', 3, 25, 60, '2000-01-01')`;
  await sql`insert into contracts values(10,2027,12000000),(10,2028,13000000),(11,2027,250000000)`;
  const edit = {playerId:10,teamId:2,contracts:{2027:15000000,2028:16000000},expected:{teamId:1,contracts:{2027:12000000,2028:13000000}}};
  await contract(edit);
  equal((await sql`select team_id from players where id=10`)[0].team_id,2);
  equal((await sql`select amount::int from contracts where player_id=10 and season=2028`)[0].amount,16000000);
  await rejects(() => contract(edit), /changed/);
  await rejects(() => contract({...edit,teamId:null,expected:{teamId:2,contracts:edit.contracts}}), /Clear/);
  await rejects(() => contract({...edit,contracts:{2027:-1},expected:{teamId:2,contracts:edit.contracts}}), /non-negative/);
  await contract({...edit,teamId:null,contracts:{},expected:{teamId:2,contracts:edit.contracts}});
  equal((await sql`select count(*)::int n from contracts where player_id=10`)[0].n,0);
  await dead({action:'save',teamId:1,label:'Release penalty',season:2027,amount:5000000});
  let entry=(await sql`select id,team_id,label,season,amount::float8 amount from dead_cap limit 1`)[0];
  await dead({action:'save',id:entry.id,expected:entry,teamId:1,label:'Retention credit',season:2027,amount:-2000000});
  equal((await sql`select sum(amount)::int amount from dead_cap where team_id=1`)[0].amount,-2000000);
  await rejects(() => dead({action:'delete',id:entry.id,expected:entry}), /changed/);
  entry=(await sql`select id,team_id,label,season,amount::float8 amount from dead_cap limit 1`)[0];
  await dead({action:'delete',id:entry.id,expected:entry});
  equal((await sql`select count(*)::int n from dead_cap`)[0].n,0);
  const bid = (playerId,amount=10000000) => ({action:'bid',roundId:1,playerId,years:[2027,2028],amounts:{2027:amount,2028:amount}});
  await rejects(() => action(bid(1),1), /not set/);
  await action({action:'deadline',roundId:1,closesAt:new Date(Date.now()+3600000).toISOString()});
  await rejects(() => action({...bid(1),years:[2028]},1), /current season/);
  await rejects(() => action({...bid(1),years:[2027,2027]},1), /consecutive/);
  await rejects(() => action(bid(1,3999999),1), /at least/);
  await rejects(() => action({...bid(1),amounts:{2027:10000000,2028:12000000}},1), /10%/);
  await rejects(() => action(bid(1),3), /hard cap/);
  await rejects(() => action(bid(11),1), /not a free agent/);
  const losing=(await action(bid(1,5000000),2)).offer;
  const winning=(await action(bid(1),1)).offer;
  await action(bid(2,8000000),1);
  const tie=(await action(bid(2,8000000),2)).offer;
  await action(bid(3),1);
  await rejects(() => action({action:'award',roundId:1,playerId:1,offerId:winning.id}), /Wait/);
  // Use an expired deadline inside this isolated fixture to exercise the cutoff.
  await sql`update fa_rounds set closes_at=clock_timestamp()-interval '1 second' where id=1`;
  await rejects(() => action(bid(4),1), /closed/);
  await rejects(() => action({action:'clear',roundId:1,playerId:1}), /closed/);
  await rejects(() => action({action:'deadline',roundId:1,closesAt:new Date(Date.now()+3600000).toISOString()}), /closed/);
  await rejects(() => action({action:'award',roundId:1,playerId:1,offerId:losing.id}), /highest/);
  await action({action:'award',roundId:1,playerId:1,offerId:winning.id});
  equal((await sql`select team_id from players where id=1`)[0].team_id,1);
  equal((await sql`select amount::int amount from contracts where player_id=1 and season=2028`)[0].amount,10000000);
  equal((await action({action:'award',roundId:1,playerId:1,offerId:winning.id})).alreadyProcessed,true);
  equal((await sql`select count(*)::int n from fa_awards where player_id=1`)[0].n,1);
  await action({action:'award',roundId:1,playerId:2,offerId:tie.id});
  equal((await sql`select team_id from players where id=2`)[0].team_id,2);
  await rejects(() => action({action:'new_round',roundId:1,closesAt:new Date(Date.now()+3600000).toISOString()}), /every player/);
  await action({action:'dismiss',roundId:1,playerId:3,note:'Fixture dismissal'});
  const next=await action({action:'new_round',roundId:1,closesAt:new Date(Date.now()+3600000).toISOString()});
  equal(next.roundId,2);
  await rejects(() => action(bid(4),1), /round changed/);
  equal(Number((await sql`select byf_bid_value(array[2027,2028], '{"2027":10000000,"2028":10000000}'::jsonb) value`)[0].value),18000000);
  // Leave useful fixture data for browser checks only when explicitly requested.
  if (process.argv.includes('--keep-fixture')) {
    const adminToken=randomBytes(24).toString('base64url');
    const ownerToken=randomBytes(24).toString('base64url');
    const subToken=randomBytes(24).toString('base64url');
    for (const [token,role,team] of [[adminToken,'commish',1],[ownerToken,null,1],[subToken,'subcommish',null]]) {
      await sql`insert into login_links(token_hash,role,team_id,kind) values(${createHash('sha256').update(token).digest('hex')},${role},${team},'team')`;
    }
    await action({ ...bid(3), roundId:2 },1);
    await action({ ...bid(4,7000000), roundId:2 },1);
    await action({ ...bid(4,7000000), roundId:2 },2);
    writeFileSync('.env.test.local','DATABASE_URL='+scoped.toString()+'\n');
    writeFileSync('.byf-fixture.json',JSON.stringify({schema,adminToken,ownerToken,subToken}));
    keep=true;
  }
  console.log('PASS: '+checks+' database assertions. Isolated database '+schema+(keep?' retained for browser checks.':' will be removed.'));
} catch (error) {
  console.error('TEST FAILED:', error.message);
  throw error;
} finally {
  if (!keep) await admin.query('drop database '+schema+' with (force)');
}

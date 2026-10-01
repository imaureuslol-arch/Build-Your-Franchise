import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

// Mock Sleeper and the database; use the real mapping and cap rules. No league mutations.
function load(file, deps = {}) {
  const code = ts.transpileModule(readFileSync(new URL('../'+file, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
  }).outputText;
  const module = {exports:{}};
  new Function('require','module','exports',code)(name => {
    assert(name in deps, 'Missing dependency '+name); return deps[name];
  },module,module.exports);
  return module.exports;
}
const types = load('src/lib/types.ts');
const year = types.getCurrentSeasonYear();
const teams = [{id:7,name:'Alpha',sleeper_roster:101},{id:9,name:'Beta',sleeper_roster:102},{id:12,name:'Gamma',sleeper_roster:103}];
const ids = [{id:1,sleeper_id:'405'},{id:2,sleeper_id:'502'}];
const player = (id,team,salary) => ({id,team,name:'Player '+id,salaries:{[year]:salary},ppg:null,avg_gp:null});
let players = [player(1,'Alpha',20e6),player(2,'Beta',25e6),{...player(-7,'Alpha',types.getSoftCap()-19e6),name:'Dead Cap'}];
let picks = [{id:types.pickPlayerId(year+2,2,12),name:`${year+2} 2nd (Gamma)`,team:'Alpha',salaries:{},ppg:null,avg_gp:null}];
let sqlReads = 0;
const sql = async strings => {
  const query = strings.join('?').trim();
  assert(query.startsWith('select'), 'Import must never mutate the database'); sqlReads++;
  return query.includes('from players') ? ids : teams;
};
const league = {loadLeague:async()=>({players,owners:[]})};
const pickLib = {loadPickPlayers:async()=>picks};
const trades = load('src/lib/trades.ts', {'./db':{sql},'./league':league,'./picks':pickLib,'./types':types});
const sleeper = load('src/lib/sleeper-trades.ts', {'./db':{sql},'./league':league,'./picks':pickLib,'./types':types,'./trades':trades});
const base = {
  transaction_id:'accepted',league_id:'league',type:'trade',status:'pending',created:Date.now(),
  roster_ids:[101,102],consenter_ids:[101,102],adds:{405:102,502:101},drops:{405:101,502:102},draft_picks:[],waiver_budget:[],
};
let checks = 0;
const test = async(name,run) => {await run(); checks++; console.log('PASS '+name);};
const oldFetch = globalThis.fetch;
const originalEnv = {token:process.env.SLEEPER_TOKEN,league:process.env.SLEEPER_LEAGUE_ID};
const restore = (name,value) => {if(value===undefined)delete process.env[name];else process.env[name]=value;};
let calls = 0;
const respond = data => {globalThis.fetch=async(url,options)=>{
  calls++;
  assert.equal(url,'https://sleeper.com/graphql'); assert.equal(options.method,'POST');
  const body=JSON.parse(options.body);
  assert(body.query.startsWith('query '));
  assert.deepEqual(body.variables,{league_id:'league',type_filters:['trade'],status_filters:['pending']});
  return Response.json(data);
};};
const queue = rows => respond({data:{league_transactions_filtered:rows}});
try {
  process.env.SLEEPER_TOKEN='fake-test-session'; process.env.SLEEPER_LEAGUE_ID='league';
  await test('only fully accepted pending trades in the configured league',async()=>{
    queue([base,{...base,transaction_id:'unaccepted',consenter_ids:[101]},
      {...base,transaction_id:'finished',status:'complete'}, {...base,transaction_id:'proposed',status:'proposed'},
      {...base,transaction_id:'other-league',league_id:'different'}, {...base,transaction_id:'waiver',type:'waiver'},
      {...base,transaction_id:'no-consent',consenter_ids:null}, {...base,transaction_id:'duplicate-team',roster_ids:[101,101]},base]);
    assert.deepEqual((await sleeper.fetchAcceptedSleeperTrades()).map(t=>t.transaction_id),['accepted']);
  });
  await test('player IDs map separately from roster and database IDs',async()=>{
    const v=sleeper.mapSleeperTrade(base,teams,ids,[...players,...picks]);
    assert.deepEqual(v.errors,[]);
    assert.deepEqual(v.items.map(i=>[i.playerId,i.from,i.to]),[[1,'Alpha','Beta'],[2,'Beta','Alpha']]);
    assert(v.teams.every(t=>t.retained===0));
  });
  await test('pick origin is distinct from its current owner, including string-encoded picks',async()=>{
    const p={season:String(year+2),round:2,roster_id:103,previous_owner_id:101,owner_id:102};
    for(const raw of [p,JSON.stringify(p)]) {
      const v=sleeper.mapSleeperTrade({...base,adds:{},drops:{},draft_picks:[raw]},teams,ids,[...players,...picks]);
      assert.deepEqual(v.errors,[]);
      assert.equal(v.items[0].playerId,types.pickPlayerId(year+2,2,12));
      assert.equal(v.items[0].from,'Alpha'); assert.equal(v.items[0].to,'Beta');
    }
  });
  await test('unmapped players, teams, removed picks and malformed picks cannot appear valid',async()=>{
    for(const t of [
      {...base,adds:{999:102},drops:{999:101}},
      {...base,roster_ids:[101,999],adds:{405:999},drops:{405:101}},
      {...base,draft_picks:[{season:String(year+1),round:1,roster_id:103,previous_owner_id:101,owner_id:102}]},
      {...base,draft_picks:['unreadable']},
      {...base,adds:{405:102},drops:{}},
    ]) {const v=sleeper.mapSleeperTrade(t,teams,ids,[...players,...picks]);assert(v.errors.length);assert.equal(v.check,'unmapped');}
  });
  await test('Sleeper FAAB never becomes salary retention',async()=>{
    const v=sleeper.mapSleeperTrade({...base,waiver_budget:[{sender:101,receiver:102,amount:10e6}]},teams,ids,players);
    assert(v.teams.every(t=>t.retained===0)); assert.match(v.notes[0],/not salary retention/);
  });
  await test('zero-retention cap violations use the real checker; agreed retention can make them legal',async()=>{
    queue([base]); const [v]=await sleeper.listSleeperTrades();
    assert.equal(v.check,'invalid'); assert.match(v.errors[0],/soft cap zone/);
    const result=await trades.checkTrade({teams:v.teams.map(t=>({...t,retained:t.team==='Beta'?6e6:0})),items:v.items});
    assert.equal(result.ok,true);
  });
  await test('legal pending trades are marked valid without executing or storing them',async()=>{
    players=players.filter(p=>p.id>0); queue([base]);
    const [v]=await sleeper.listSleeperTrades();assert.equal(v.check,'valid');assert.deepEqual(v.errors,[]);assert(sqlReads>0);
  });
  await test('already moved assets are not checked against the wrong pre-trade owners',async()=>{
    players=players.map(p=>({...p,team:p.id===1?'Beta':'Alpha'}));queue([base]);
    const [v]=await sleeper.listSleeperTrades();assert.equal(v.check,'ownership_updated');assert.deepEqual(v.errors,[]);
    assert.match(v.notes[0],/Retention has not been verified/);
  });
  await test('expired sessions and upstream errors produce safe connection errors',async()=>{
    respond({data:{league_transactions_filtered:null},errors:[{code:'unauthorized',message:'private upstream detail'}]});
    await assert.rejects(sleeper.fetchAcceptedSleeperTrades(),e=>e.status===503&&/Replace SLEEPER_TOKEN/.test(e.message)&&!e.message.includes('private upstream'));
    respond({errors:[{message:'private upstream detail'}]});
    await assert.rejects(sleeper.fetchAcceptedSleeperTrades(),e=>e.status===502&&!e.message.includes('private upstream'));
    globalThis.fetch=async()=>{throw Error('private upstream detail');};
    await assert.rejects(sleeper.fetchAcceptedSleeperTrades(),/could not be reached/);
  });
  await test('missing configuration does not attempt a network request',async()=>{
    const before=calls;delete process.env.SLEEPER_TOKEN;
    await assert.rejects(sleeper.fetchAcceptedSleeperTrades(),e=>e.status===503);
    assert.equal(calls,before);process.env.SLEEPER_TOKEN='fake-test-session';
  });
  await test('unauthenticated BYF visitors cannot use the account connection',async()=>{
    let invoked=false;
    const route=load('src/app/api/trades/sleeper/route.ts',{
      '@/lib/auth':{getViewer:async()=>null,notLoggedIn:()=>Response.json({error:'login required'},{status:401})},
      '@/lib/sleeper-trades':{...sleeper,listSleeperTrades:async()=>{invoked=true;return[];}},
    });
    assert.equal((await route.GET()).status,401);assert.equal(invoked,false);
  });
  await test('authenticated route returns only mapped trades and disables caching',async()=>{
    players=players.map(p=>({...p,team:p.id===1?'Alpha':'Beta'}));queue([base]);
    const route=load('src/app/api/trades/sleeper/route.ts',{
      '@/lib/auth':{getViewer:async()=>({teamId:7})},'@/lib/sleeper-trades':sleeper,
    });
    const response=await route.GET();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    const body=await response.json();assert.equal(body.trades[0].check,'valid');assert(body.checkedAt);
    assert(!JSON.stringify(body).includes('fake-test-session'));
  });
  await test('route failures do not expose database or session details',async()=>{
    const route=load('src/app/api/trades/sleeper/route.ts',{
      '@/lib/auth':{getViewer:async()=>({teamId:7})},
      '@/lib/sleeper-trades':{...sleeper,listSleeperTrades:async()=>{throw Error('private database URL');}},
    });
    const response=await route.GET();assert.equal(response.status,500);assert(!(await response.text()).includes('private database'));
  });
  console.log(`${checks} Sleeper trade checks passed.`);
} finally {
  globalThis.fetch=oldFetch;
  restore('SLEEPER_TOKEN',originalEnv.token);restore('SLEEPER_LEAGUE_ID',originalEnv.league);
}

import {neon} from '@neondatabase/serverless';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer,request as httpRequest} from 'node:http';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Every mutation is confined to a new disposable database, never the league.
if (!process.env.DATABASE_URL) process.loadEnvFile('.env.local');
const admin=neon(process.env.DATABASE_URL);
const database='byf_market_test_'+Date.now();
assert.match(database,/^byf_market_test_\d+$/);
await admin.query('create database '+database);
const scoped=new URL(process.env.DATABASE_URL); scoped.pathname='/'+database;
const sql=neon(scoped.toString());
let checks=0;
const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
const reject=async(fn,pattern)=>{await assert.rejects(fn,pattern);checks++;};
function load(path,deps={}) {
  const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',code)(name=>{assert(name in deps,'Missing test dependency: '+name);return deps[name];},mod,mod.exports);
  return mod.exports;
}
const types=load('src/lib/types.ts');
const rules=load('src/lib/free-agency-rules.ts',{'./types':types});
const action=async(body,team=null,season=2027)=>(await sql`select byf_fa_action(${JSON.stringify(body)}::jsonb,null::uuid,${team}::int,${season}::int) result`)[0].result;
const bid=(playerId,amount)=>({action:'bid',roundId:1,playerId,years:[2027],amounts:{2027:amount}});
const auction=async id=>(await sql`select * from fa_player_auctions where round_id=1 and player_id=${id}`)[0];
const finish=async(player,team,owner,version,years,accepted=true,used=0)=>sql`select byf_extension_finish(${player}::int,${team}::int,${owner},${version}::int,${years}::int[],${JSON.stringify(Object.fromEntries(years.map(y=>[y,10000000])))}::jsonb,${accepted}::boolean,${used}::int)`;
try {
  equal((await sql`select current_database() db`)[0].db,database);
  const base=readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8');
  await sql.transaction(base.split(/;\s*(?:\r?\n|$)/).filter(s=>s.trim()).map(s=>sql.query(s)));
  const migrations=readdirSync(new URL('../db/migrations/',import.meta.url)).filter(s=>s.endsWith('.sql')).sort();
  for (const file of migrations) {
    if (file==='009-player-free-agency.sql') {
      await sql`insert into teams(id,name) values(90,'Legacy bidding')`;
      await sql`insert into players(id,name,fair_value) values(90,'Legacy low bid',20),(91,'Legacy premium bid',20)`;
      await sql`update fa_rounds set closes_at=clock_timestamp()+interval '127 days' where id=1`;
      await sql`insert into free_agent_offers(round_id,player_id,team_id,years,amounts,total_value,created_at) values
        (1,90,90,'{2027}','{"2027":10000000}',10000000,clock_timestamp()-interval '2 hours'),
        (1,90,90,'{2027}','{"2027":40000000}',40000000,clock_timestamp()-interval '1 hour'),
        (1,91,90,'{2027}','{"2027":40000000}',40000000,clock_timestamp()-interval '2 hours')`;
    }
    if (file==='010-independent-free-agency-clock.sql') {
      equal(Number((await sql`select extract(epoch from accepts_at-first_bid_at)/86400 days from fa_player_auctions where player_id=90`)[0].days),30.5);
      equal(Number((await sql`select extract(epoch from accepts_at-first_bid_at)/86400 days from fa_player_auctions where player_id=91`)[0].days),3);
      // Reproduce the deployed bug, including a subsequent twelve-hour rebid.
      await sql`update fa_player_auctions a set accepts_at=r.closes_at+case when a.player_id=90 then interval '12 hours' else interval '0 hours' end
        from fa_rounds r where r.id=a.round_id and a.player_id in (90,91)`;
    }
    const source=readFileSync(new URL('../db/migrations/'+file,import.meta.url),'utf8');
    await sql.transaction(source.split(/\r?\n-- statement\r?\n/).filter(s=>s.trim()).map(s=>sql.query(s)));
  }
  equal(Number((await sql`select extract(epoch from accepts_at-first_bid_at)/86400 days from fa_player_auctions where player_id=90`)[0].days),30.5);
  equal(Number((await sql`select extract(epoch from accepts_at-first_bid_at)/86400 days from fa_player_auctions where player_id=91`)[0].days),3);
  const legacyDeadline=(await auction(90)).accepts_at;
  await action({action:'deadline',roundId:1,closesAt:new Date(Date.now()+60*86400000).toISOString()});
  equal((await auction(90)).accepts_at,legacyDeadline);
  // Repeating the correction must not reset deadlines or write another repair.
  const repairSource=readFileSync(new URL('../db/migrations/010-independent-free-agency-clock.sql',import.meta.url),'utf8');
  await sql.transaction(repairSource.split(/\r?\n-- statement\r?\n/).filter(s=>s.trim()).map(s=>sql.query(s)));
  equal((await auction(90)).accepts_at,legacyDeadline);
  equal((await sql`select count(*)::int n from audit_log where action='fa_player_deadline_corrected'`)[0].n,2);
  await sql`delete from fa_player_auctions where player_id in (90,91)`;
  await sql`delete from free_agent_offers where player_id in (90,91)`;
  await sql`delete from players where id in (90,91)`;
  await sql`delete from teams where id=90`;
  // New migrations must also be repeat-safe.
  for (const file of migrations.filter(s=>/^00[789]-/.test(s))) {
    const source=readFileSync(new URL('../db/migrations/'+file,import.meta.url),'utf8');
    await sql.transaction(source.split(/\r?\n-- statement\r?\n/).filter(s=>s.trim()).map(s=>sql.query(s)));
  }
  await sql`insert into teams(id,name,sleeper_user_id) values(1,'Alpha','a'),(2,'Beta','b'),(3,'Over Cap','c')`;
  await sql`insert into players(id,name,team_id,nba_experience,fair_value) values
    (1,'Premium FA',null,5,20),(2,'Underbid FA',null,5,20),(3,'Other FA',null,5,8),(4,'Unknown FA',null,5,null),
    (10,'Extended Player',1,5,20),(11,'Rookie',1,0,20),(12,'Unknown Experience',1,null,20),
    (13,'Over Cap Player',3,5,20),(14,'Concurrent Extension',1,5,20),(15,'Trade Player',1,5,20),(16,'Trade Return',2,5,20),
    (17,'Unmatched RFA',1,5,20)`;
  await sql`insert into contracts values(10,2027,10000000),(11,2027,5000000),(12,2027,5000000),(13,2027,250000000),
    (14,2027,5000000),(15,2027,5000000),(16,2027,5000000),(17,2027,5000000)`;
  for (const fair of [5000000,8000000,10000000,20000000,80000000]) {
    for (const ratio of [.1,.5,.6,.8,1,1.5,2,3]) {
      const weighted=Math.round(fair*ratio);
      const days=Number((await sql`select byf_fa_days(${weighted}::numeric,${fair}::numeric) days`)[0].days);
      assert(Math.abs(days-rules.acceptanceDays(weighted,fair))<1e-8); checks++;
    }
  }
  equal(rules.acceptanceDays(40000000,20000000),3);
  equal(rules.acceptanceDays(15000000,5000000),3);
  equal(rules.acceptanceDays(10000000,5000000)>3,true);
  equal(rules.acceptanceDays(16000000,20000000),14);
  equal(rules.acceptanceDays(10000000,20000000),30);
  equal(rules.isSevereUnderbid(4000000,20000000),true);
  equal(rules.isSevereUnderbid(10000000,20000000),false);
  equal(rules.isSevereUnderbid(4000000,12000000),false);
  await reject(()=>action(bid(4,10000000),1),/fair value/);
  await reject(()=>action(bid(1,4000000),1),/minimum/);
  await reject(()=>action(bid(1,40000000),3),/hard cap/);
  const premium=(await action(bid(1,40000000),1)).offer;
  let first=await auction(1);
  assert(Math.abs((Date.parse(first.accepts_at)-Date.parse(first.first_bid_at))/86400000-3)<.00001);checks++;
  const firstDeadline=Date.parse(first.accepts_at);
  await action({action:'deadline',roundId:1,closesAt:new Date(Date.now()+90*86400000).toISOString()});
  equal((await auction(1)).accepts_at,first.accepts_at);
  await action(bid(1,50000000),2);
  let second=await auction(1);
  equal(Date.parse(second.accepts_at)-firstDeadline,12*3600000);
  equal(second.first_bid_at,first.first_bid_at);
  equal(Number(second.fair_value),20000000);
  const settled=await Promise.all([action(bid(1,52000000),1),action(bid(1,54000000),2)]);
  equal(Date.parse((await auction(1)).accepts_at)-Date.parse(second.accepts_at),24*3600000);
  const losing=(await action(bid(2,5000000),2)).offer;
  const under=await auction(2);
  assert(Math.abs((Date.parse(under.accepts_at)-Date.parse(under.first_bid_at))/86400000-30)<.00001);checks++;
  await action({action:'clear',roundId:1,playerId:2});
  equal((await auction(2)).accepts_at,under.accepts_at);
  const winning=(await action(bid(2,30000000),1)).offer;
  equal(Date.parse((await auction(2)).accepts_at)-Date.parse(under.accepts_at),12*3600000);
  await reject(()=>action({action:'award',roundId:1,playerId:2,offerId:winning.id}),/Wait/);
  await sql`update fa_player_auctions set accepts_at=clock_timestamp()-interval '1 second' where player_id in (1,2)`;
  await reject(()=>action(bid(1,60000000),1),/closed/);
  await reject(()=>action({action:'award',roundId:1,playerId:1,offerId:premium.id}),/highest/);
  await action({action:'award',roundId:1,playerId:1,offerId:settled[1].offer.id});
  equal((await sql`select team_id,contract_version from players where id=1`)[0],{team_id:2,contract_version:2});
  equal((await action({action:'award',roundId:1,playerId:1,offerId:settled[1].offer.id})).alreadyProcessed,true);
  equal((await sql`select count(*)::int n from fa_awards where player_id=1`)[0].n,1);
  equal((await sql`select count(*)::int n from free_agent_offers where id=${losing.id}::uuid`)[0].n,0);
  await action({action:'award',roundId:1,playerId:2,offerId:winning.id});
  await reject(()=>finish(11,1,'sleeper:a',1,[2028]),/Rookies/);
  await reject(()=>finish(12,1,'sleeper:a',1,[2028]),/experience/);
  await finish(10,1,'sleeper:a',1,[2028]);
  await reject(()=>finish(10,1,'sleeper:a',1,[2029]),/already/);
  // Trading the same contract changes neither the restriction nor the version.
  await sql`update players set team_id=2 where id=10`;
  await reject(()=>finish(10,2,'sleeper:b',1,[2029]),/already/);
  await sql`select byf_refresh_rfas(2029)`;
  equal((await sql`select team_id from players where id=10`)[0].team_id,null);
  equal((await sql`select owner_key,team_id from restricted_free_agents where player_id=10`)[0],{owner_key:'sleeper:b',team_id:2});
  equal((await sql`select count(*)::int n from restricted_free_agents where player_id=11`)[0].n,0);
  const rfa=(await action({action:'bid',roundId:1,playerId:10,years:[2029],amounts:{2029:40000000}},1,2029)).offer;
  await sql`update fa_player_auctions set accepts_at=clock_timestamp()-interval '1 second' where player_id=10`;
  await reject(()=>action({action:'award',roundId:1,playerId:10,offerId:rfa.id},null,2029),/seven-day/);
  await reject(()=>action({action:'match',roundId:1,playerId:10,offerId:rfa.id},1,2029),/previous owner/);
  await action({action:'match',roundId:1,playerId:10,offerId:rfa.id},2,2029);
  equal((await sql`select team_id from players where id=10`)[0].team_id,null); // Matching alone never auto-awards.
  equal((await action({action:'match',roundId:1,playerId:10,offerId:rfa.id},2,2029)).alreadyProcessed,true);
  await action({action:'award',roundId:1,playerId:10,offerId:rfa.id},null,2029);
  equal((await sql`select team_id,contract_version from players where id=10`)[0],{team_id:2,contract_version:2});
  await sql`update players set team_id=1 where id=10`;
  await reject(()=>finish(10,1,'sleeper:a',1,[2030]),/new contract/);
  await finish(10,1,'sleeper:a',2,[2030]); // Original owner can extend the new contract.
  equal((await sql`select count(*)::int n from extensions where player_id=10 and accepted`)[0].n,2);
  const concurrent=await Promise.allSettled([finish(14,1,'sleeper:a',1,[2028]),finish(14,1,'sleeper:a',1,[2028])]);
  equal(concurrent.filter(r=>r.status==='fulfilled').length,1);
  equal((await sql`select count(*)::int n from extensions where player_id=14`)[0].n,1);
  await finish(17,1,'sleeper:a',1,[2028]);
  await sql`select byf_refresh_rfas(2029)`;
  const unmatched=(await action({action:'bid',roundId:1,playerId:17,years:[2029],amounts:{2029:40000000}},2,2029)).offer;
  await sql`update fa_player_auctions set accepts_at=clock_timestamp()-interval '8 days' where player_id=17`;
  await reject(()=>action({action:'match',roundId:1,playerId:17,offerId:unmatched.id},1,2029),/closed/);
  await action({action:'award',roundId:1,playerId:17,offerId:unmatched.id},null,2029);
  equal((await sql`select team_id from players where id=17`)[0].team_id,2);
  // An unprocessed RFA must not be silently put back on its Sleeper roster.
  await sql`update teams set sleeper_roster=id`;
  await sql`update players set sleeper_id=id::text`;
  const liveTeams=await sql`select id,team_id from players where team_id is not null`;
  const rosters=[1,2,3].map(team=>({roster_id:team,owner_id:String(team),players:liveTeams.filter(p=>p.team_id===team).map(p=>String(p.id))}));
  rosters[0].players.push('14');
  const sync=load('src/lib/sleeper-sync.ts',{
    './db':{sql},'./picks':{applyPicks:async()=>[],pickDifferences:async()=>[],seedPicks:async()=>{},sleeperPicks:async()=>[]},
    './sleeper-conferences':{conferencesFromSleeper:()=>new Map()},
  });
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(url,options)=>String(url).startsWith('https://api.sleeper.app/')
    ? Promise.resolve(Response.json(rosters)) : originalFetch(url,options);
  try {
    const applied=await sync.applySleeperRosters('fixture',2029);
    equal(applied.joined.includes('Concurrent Extension (Alpha)'),false);
    equal((await sql`select team_id from players where id=14`)[0].team_id,null);
  } finally {globalThis.fetch=originalFetch;}

  // A counter replaces terms in place, keeps assets unmoved, and resets consent.
  const tradeId=randomUUID();
  await sql`insert into trades(id,proposed_by,season,status) values(${tradeId}::uuid,1,2027,'proposed')`;
  await sql`insert into trade_teams(trade_id,team_id,accepted_at) values(${tradeId}::uuid,1,now()),(${tradeId}::uuid,2,null)`;
  await sql`insert into trade_items(trade_id,player_id,from_team,to_team) values(${tradeId}::uuid,15,1,2),(${tradeId}::uuid,16,2,1)`;
  const counter={teams:[{teamId:1,retained:1000000},{teamId:2,retained:0}],items:[
    {playerId:15,fromTeam:1,toTeam:2,kind:'player'},
    {playerId:16,fromTeam:2,toTeam:1,kind:'player'},
    {playerId:null,fromTeam:2,toTeam:1,kind:'pick',pickSeason:2028,pickRound:2,pickOriginal:2}]};
  const reply=(team,revision,action,payload=null)=>sql`select byf_trade_reply(${tradeId}::uuid,${team}::int,${revision}::int,${action},${JSON.stringify(payload)}::jsonb)`;
  await reject(()=>reply(3,0,'counter',counter),/not a team/);
  await reject(()=>reply(1,0,'counter',counter),/waiting/);
  await reject(()=>reply(2,0,'counter',{...counter,teams:[{teamId:2,retained:0},{teamId:3,retained:0}]}),/same teams/);
  await reply(2,0,'counter',counter);
  equal((await sql`select revision,proposed_by,status from trades where id=${tradeId}::uuid`)[0],{revision:1,proposed_by:2,status:'proposed'});
  equal((await sql`select team_id,accepted_at is not null accepted from trade_teams where trade_id=${tradeId}::uuid order by team_id`),[{team_id:1,accepted:false},{team_id:2,accepted:true}]);
  equal((await sql`select count(*)::int n from trade_items where trade_id=${tradeId}::uuid`)[0].n,3);
  equal((await sql`select team_id from players where id=15`)[0].team_id,1);
  await reject(()=>reply(1,0,'accept'),/changed/);
  await reject(()=>reply(2,1,'counter',counter),/waiting/);
  await reply(1,1,'counter',counter);
  await reply(2,2,'accept');
  equal((await sql`select status from trades where id=${tradeId}::uuid`)[0].status,'accepted');
  await reject(()=>reply(2,2,'counter',counter),/waiting/);
  await action({action:'bid',roundId:1,playerId:3,years:[2029],amounts:{2029:20000000}},1,2029);
  await reject(()=>action({action:'new_round',roundId:1}),/every player/);
  await sql`update fa_player_auctions set accepts_at=clock_timestamp()-interval '1 second' where player_id=3`;
  await action({action:'dismiss',roundId:1,playerId:3,note:'Fixture dismissal'},null,2029);
  equal((await action({action:'new_round',roundId:1},null,2029)).roundId,2);
  await reject(()=>action(bid(3,10000000),1),/round changed/);
  console.log('PASS: '+checks+' market/contract/counter assertions in isolated database.');
  if (process.argv.includes('--preview')) {
    const season=types.getCurrentSeasonYear();
    await sql`update players set nba_team='BOS',birthdate='2000-01-01',ppg=20,avg_gp=65`;
    await sql`update teams set owner_name=name`;
    await sql`insert into players(id,name,nba_team,birthdate,ppg,avg_gp,nba_experience,fair_value) values
      (30,'Low Bid Player','BOS','2000-01-01',20,65,5,20),(31,'Premium Bid Player','BOS','2000-01-01',25,65,5,20),
      (32,'Restricted Player','BOS','2000-01-01',22,65,5,20)`;
    await sql`insert into restricted_free_agents(player_id,owner_key,team_id,expires_season) values(32,'sleeper:b',2,${season-1})`;
    for (const [player,amount] of [[30,5000000],[31,40000000],[32,40000000]]) {
      await action({action:'bid',roundId:2,playerId:player,years:[season],amounts:{[season]:amount}},1,season);
    }
    await sql`update fa_player_auctions set accepts_at=clock_timestamp()-interval '1 hour' where round_id=2 and player_id=32`;
    const previewTrade=randomUUID();
    await sql`insert into trades(id,status,proposed_by,season) values(${previewTrade}::uuid,'proposed',1,${season})`;
    await sql`insert into trade_teams(trade_id,team_id,retained,accepted_at) values(${previewTrade}::uuid,1,1000000,now()),(${previewTrade}::uuid,2,0,null)`;
    await sql`insert into draft_picks values(${season+1},2,2,2)`;
    await sql`insert into trade_items(trade_id,player_id,from_team,to_team,kind,pick_season,pick_round,pick_original) values
      (${previewTrade}::uuid,15,1,2,'player',null,null,null),(${previewTrade}::uuid,16,2,1,'player',null,null,null),
      (${previewTrade}::uuid,null,2,1,'pick',${season+1},2,2)`;
    // Disposable fixture sessions stay in process memory. The loopback proxy
    // injects them only into the isolated local server, never into production.
    const sessions={};
    for (const role of ['owner','commissioner']) {
      const token=randomBytes(24).toString('base64url');
      await sql`insert into sessions(token_hash,team_id,role) values(${createHash('sha256').update(token).digest('hex')},2,${role==='commissioner'?'commish':null})`;
      sessions[role]=token;
    }
    const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3101'],{
      cwd:process.cwd(),env:{...process.env,DATABASE_URL:scoped.toString(),SLEEPER_LEAGUE_ID:''},stdio:['ignore','pipe','pipe'],windowsHide:true,
    });
    app.stdout.on('data',data=>process.stdout.write(data));
    app.stderr.on('data',data=>process.stderr.write(data));
    const proxies=[];
    let stopPreview;
    const stopped=new Promise(resolve=>{stopPreview=resolve;});
    for (const [port,role] of [[3102,'owner'],[3103,'commissioner']]) {
      const proxy=createServer((req,res)=>{
        if(req.url==='/__stop-fixture' && req.method==='POST') {res.end('Stopped');stopPreview();return;}
        const forward=httpRequest({hostname:'127.0.0.1',port:3101,path:req.url,method:req.method,
          headers:{...req.headers,host:'localhost:3101',cookie:'byf_session='+sessions[role]}},upstream=>{
            res.writeHead(upstream.statusCode,upstream.headers); upstream.pipe(res);
          });
        forward.on('error',()=>{res.writeHead(503);res.end('Fixture server starting');});
        req.pipe(forward);
      });
      await new Promise(resolve=>proxy.listen(port,'127.0.0.1',resolve));proxies.push(proxy);
    }
    console.log('Isolated preview: owner http://127.0.0.1:3102; commissioner http://127.0.0.1:3103. Stop to remove the fixture.');
    process.once('SIGINT',stopPreview);process.once('SIGTERM',stopPreview);app.once('exit',stopPreview);
    await stopped;
    proxies.forEach(proxy=>proxy.closeAllConnections());
    await Promise.all(proxies.map(proxy=>new Promise(resolve=>proxy.close(resolve))));
    app.kill();
    await new Promise(resolve=>app.exitCode!=null?resolve():app.once('exit',resolve));
  }
} finally { await admin.query('drop database '+database+' with (force)'); }

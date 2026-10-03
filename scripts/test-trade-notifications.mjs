import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// All outbound messages and database operations are mocked; no league activity.
function load(file, deps = {}) {
  const code = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert(name in deps, 'Missing dependency ' + name); return deps[name];
  }, compiled, compiled.exports);
  return compiled.exports;
}
const messaging = load('src/lib/sleeper-messages.ts');
const originalFetch = globalThis.fetch;
const originalToken = process.env.SLEEPER_TOKEN;
const botId = '1412094574553280512';
let calls = [];
let checks = 0;
const test = async (name, run) => { await run(); checks++; console.log('PASS ' + name); };
const mockSleeper = ({ existing = true, error = null, failure = null, mismatch = false, sender = botId, encoded = false, metadataEmpty = false, history = 'sent' } = {}) => {
  calls = [];
  let firstText;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://sleeper.com/graphql');
    assert.equal(options.headers.authorization, 'fake-session');
    assert.equal(options.cache, 'no-store'); assert(options.signal);
    const body = JSON.parse(options.body); calls.push(body);
    if (failure) throw Error(failure);
    if (error) return Response.json({ errors: [{ code: error, message: 'SECRET-upstream-detail' }] });
    const v = body.variables;
    if (body.operationName === 'create_dm') {
      assert.equal(v.members.length, 1); assert.notEqual(v.members[0], sender);
      firstText = v.message_text;
    }
    const firstMessage = { message_id: '401', author_id: history === 'wrong-author' ? 'other' : sender,
      text: encoded ? firstText?.replaceAll("'", '&#39;') : firstText, created: history === 'old' ? 1 : Date.now(),
      client_id: history === 'wrong-client' ? 'other-request' : null };
    const data = {
      me: { user_id: sender },
      get_dm_by_members: existing ? { dm_id: '300', dm_type: 'single' } : null,
      create_message: { message_id: '400', parent_id: mismatch ? 'wrong-room' : '300', author_id: sender, text: encoded ? v.text?.replaceAll("'",'&#39;') : v.text },
      create_dm: { dm_id: '300', dm_type: 'single', last_message_id: '400', last_author_id: metadataEmpty ? null : sender, last_message_text: metadataEmpty ? null : encoded ? v.message_text?.replaceAll("'",'&#39;') : v.message_text },
      messages: history === 'empty' ? [] : history === 'duplicate' ? [firstMessage, {...firstMessage, message_id: '402'}] : [firstMessage],
    };
    return Response.json({ data: { [body.operationName]: data[body.operationName] } });
  };
};
const teams = [
  { id: 1, name: 'Alpha', owner_name: 'Manager A', sleeper_user_id: '100' },
  { id: 2, name: 'Beta', owner_name: 'Manager B', sleeper_user_id: '200' },
  { id: 3, name: 'Gamma', owner_name: 'Manager C', sleeper_user_id: '201' },
];
const input = {
  teams: teams.map(t => ({ team: t.name, retained: 0 })),
  items: [
    { playerId: 10, from: 'Alpha', to: 'Beta' },
    { playerId: 20, from: 'Beta', to: 'Alpha' },
    { playerId: -123, from: 'Gamma', to: 'Beta' },
    { playerId: 30, from: 'Beta', to: 'Gamma' },
  ],
};
const players = new Map([
  [10, { name: 'Luka Doncic' }], [20, { name: 'Jalen Brunson' }],
  [-123, { name: '2028 2nd (Original Team)' }], [30, { name: 'Devin Vassell' }],
]);
let teamRows = teams;
let sent = [];
let failedUser = null;
const notifications = load('src/lib/trade-notifications.ts', {
  './db': { sql: async strings => { assert.match(strings.join('?'), /^select /); return teamRows; } },
  './sleeper-messages': { ...messaging, sendSleeperDm: async (...args) => {
    sent.push(args);
    if (args[0] === failedUser) throw Error('SECRET-private-database-url');
  } },
});
try {
  process.env.SLEEPER_TOKEN = 'fake-session';
  await test('existing DM targets the intended recipient and sends once', async () => {
    mockSleeper(); await messaging.sendSleeperDm('200', 'Offer text', 'trade-client-id');
    assert.deepEqual(calls.map(c => c.operationName), ['me', 'get_dm_by_members', 'create_message']);
    assert.deepEqual(calls[1].variables.members, [botId, '200']);
    assert.deepEqual(calls[2].variables, { parent_id: '300', parent_type: 'dm', text: 'Offer text', client_id: 'trade-client-id' });
  });
  await test('new DM includes its first message in the creation request', async () => {
    mockSleeper({ existing: false }); await messaging.sendSleeperDm('200', 'Offer text', 'trade-client-id');
    assert.deepEqual(calls.map(c => c.operationName), ['me', 'get_dm_by_members', 'create_dm']);
    assert.deepEqual(calls[2].variables, { members: ['200'], dm_type: 'single', message_text: 'Offer text', client_id: 'trade-client-id' });
  });
  await test('empty new-DM metadata confirms the sent message by reading without sending again', async () => {
    mockSleeper({existing:false, metadataEmpty:true, encoded:true});
    await messaging.sendSleeperDm('200', "De'Anthony Melton", 'trade-client-id');
    assert.deepEqual(calls.map(c=>c.operationName), ['me','get_dm_by_members','create_dm','messages']);
    assert.deepEqual(calls[3].variables, {parent_id:'300'});
  });
  await test('unconfirmed new-DM history never triggers a resend', async () => {
    for (const history of ['empty','wrong-author','wrong-client','old','duplicate']) {
      mockSleeper({existing:false, metadataEmpty:true, history});
      await assert.rejects(messaging.sendSleeperDm('200','Offer text','trade-client-id'), /did not confirm/);
      assert.equal(calls.filter(c=>c.operationName==='create_dm').length,1);
      assert.equal(calls.filter(c=>c.operationName==='create_message').length,0);
    }
  });
  await test('site notifications reject personal accounts before sending', async () => {
    mockSleeper({sender:'100'});
    await assert.rejects(messaging.sendSleeperDm('200','Offer','client'),/Connect FranchiseManagerBot/);
    assert.deepEqual(calls.map(c=>c.operationName),['me']);
  });
  await test('HTML-encoded apostrophes confirm without a second send', async () => {
    for (const existing of [true,false]) {
      mockSleeper({existing,encoded:true});
      await messaging.sendSleeperDm('200',"De'Anthony Melton",'client');
      assert.equal(calls.length,3);
    }
  });
  await test('expired auth, network failures and unconfirmed destinations never retry or expose secrets', async () => {
    for (const options of [{ error: 'unauthorized' }, { failure: 'SECRET-session' }, { mismatch: true }]) {
      mockSleeper(options);
      await assert.rejects(messaging.sendSleeperDm('200', 'Offer text', 'client'), e =>
        e instanceof messaging.SleeperMessageError && !e.message.includes('SECRET'));
      assert(calls.filter(c => c.operationName === 'create_message').length <= 1);
    }
  });
  await test('missing configuration and bad recipient IDs never call Sleeper', async () => {
    mockSleeper(); delete process.env.SLEEPER_TOKEN;
    await assert.rejects(messaging.sendSleeperDm('200', 'Offer', 'client'), /not configured/);
    process.env.SLEEPER_TOKEN = 'fake-session';
    await assert.rejects(messaging.sendSleeperDm('unknown', 'Offer', 'client'), /no valid Sleeper/);
    assert.equal(calls.length, 0);
  });
  await test('recipient perspective includes all incoming and outgoing players and original pick names', async () => {
    assert.equal(notifications.tradeOfferMessage(input, players, teams[0], 'Beta'),
      'You have received a Trade Offer!\nSender: Manager A (Alpha)\nYou Send: Jalen Brunson, Devin Vassell\nYou Receive: Luka Doncic, 2028 2nd (Original Team)');
    const retaining = { ...input, teams: input.teams.map(t => ({ ...t, retained: t.team === 'Alpha' ? 5e6 : 0 })) };
    assert.match(notifications.tradeOfferMessage(retaining, players, teams[0], 'Beta'), /Salary Retained: Alpha: \$5,000,000$/);
  });
  await test('multi-team offers notify every recipient, never the proposing team', async () => {
    sent = []; const result = await notifications.notifyTradeOffer('trade-id', 0, 1, input, players);
    assert.deepEqual(result.warnings, []); assert.deepEqual(result.sent.sort(), ['Beta', 'Gamma']);
    assert.deepEqual(sent.map(s => s[0]), ['200', '201']);
    assert.equal(sent[0][2], 'byf-trade-trade-id-0-200');
    assert.match(sent[1][1], /You Send: 2028 2nd \(Original Team\)\nYou Receive: Devin Vassell/);
  });
  await test('one manager owning two receiving teams gets one combined DM', async () => {
    teamRows = teams.map(t => ({ ...t, sleeper_user_id: t.id === 3 ? '200' : t.sleeper_user_id }));
    sent = []; await notifications.notifyTradeOffer('trade-id', 1, 1, input, players);
    assert.equal(sent.length, 1); assert.equal(sent[0][1].split('You have received a Trade Offer!').length, 3);
    teamRows = teams;
  });
  await test('missing recipient links and send failures are warnings without leaking upstream errors', async () => {
    teamRows = teams.map(t => ({ ...t, sleeper_user_id: t.id === 3 ? null : t.sleeper_user_id }));
    failedUser = '200'; const result = await notifications.notifyTradeOffer('trade-id', 0, 1, input, players);
    assert.equal(result.sent.length, 0); assert.equal(result.warnings.length, 2);
    assert(!JSON.stringify(result).includes('SECRET')); failedUser = null; teamRows = teams;
  });

  const viewer = { teamId: 1, teamName: 'Alpha', role: null };
  let currentViewer = viewer;
  let validationOk = true;
  let recorded = false;
  let routeEvents = [];
  const checked = { ok: true, teamIds: new Map(teams.map(t => [t.name, t.id])), players };
  const deps = {
    '@/lib/auth': { getViewer: async () => currentViewer, isAnyCommish: v => v.role === 'commish',
      notLoggedIn: () => Response.json({}, { status: 401 }), forbidden: () => Response.json({}, { status: 403 }), audit: async () => {} },
    '@/lib/trades': { checkTrade: async () => validationOk ? checked : { ok: false, errors: ['Illegal trade'] },
      createTrade: async () => { routeEvents.push('saved'); return 'trade-id'; },
      executeTrade: async () => { recorded = true; return []; } },
    '@/lib/sleeper-sync': { checkRosters: async () => {} },
    '@/lib/trade-notifications': { notifyTradeOffer: async (...args) => {
      assert(routeEvents.includes('saved')); routeEvents.push(['notified', ...args.slice(0, 3)]);
      return { sent: [], warnings: ['Delivery unconfirmed'] };
    } },
  };
  const route = load('src/app/api/trades/route.ts', deps);
  const request = body => ({ json: async () => body });
  await test('proposal remains successful when notification delivery fails; save precedes send', async () => {
    const response = await route.POST(request({ trade: input }));
    assert.equal(response.status, 201); assert.equal((await response.json()).id, 'trade-id');
    assert.deepEqual(routeEvents, ['saved', ['notified', 'trade-id', 0, 1]]);
  });
  await test('unauthenticated and illegal offers send no notifications', async () => {
    routeEvents = []; currentViewer = null;
    assert.equal((await route.POST(request({ trade: input }))).status, 401);
    currentViewer = viewer; validationOk = false;
    assert.equal((await route.POST(request({ trade: input }))).status, 422);
    assert.deepEqual(routeEvents, []); validationOk = true;
  });
  await test('recording an already completed trade does not send an offer DM', async () => {
    routeEvents = []; currentViewer = { ...viewer, role: 'commish' };
    assert.equal((await route.POST(request({ trade: input, record: true }))).status, 201);
    assert.equal(recorded, true); assert.deepEqual(routeEvents, ['saved']); currentViewer = viewer;
  });
  let stale = false;
  const counterSql = async strings => {
    const query = strings.join('?');
    if (query.includes('from trades')) return [{ id: 'trade-id', status: 'proposed', proposed_by: 2 }];
    if (query.includes('from trade_teams')) return [{ team_id: 1, accepted_at: null }];
    if (stale) throw Error('Stale revision');
    routeEvents.push('saved'); return [{ result: { ok: true, revision: 4 } }];
  };
  const counterRoute = load('src/app/api/trades/[id]/route.ts', {
    ...deps, '@/lib/db': { sql: counterSql }, '@/lib/types': { isPickId: () => false, decodePickId: () => null },
    '@/lib/admin-errors': { adminError: () => Response.json({}, { status: 409 }) },
  });
  await test('counter notifies after the atomic reply and uses the new revision', async () => {
    routeEvents = [];
    const response = await counterRoute.POST(request({ action: 'counter', revision: 3, trade: input }), { params: Promise.resolve({ id: 'trade-id' }) });
    assert.equal(response.status, 200); assert.equal((await response.json()).revision, 4);
    assert.deepEqual(routeEvents, ['saved', ['notified', 'trade-id', 4, 1]]);
  });
  await test('stale counters and acceptance actions send no offer notifications', async () => {
    stale = true; routeEvents = [];
    assert.equal((await counterRoute.POST(request({ action: 'counter', revision: 3, trade: input }), { params: Promise.resolve({ id: 'trade-id' }) })).status, 409);
    assert.deepEqual(routeEvents, []); stale = false;
    await counterRoute.POST(request({ action: 'accept', revision: 3 }), { params: Promise.resolve({ id: 'trade-id' }) });
    assert.deepEqual(routeEvents, ['saved']);
  });
  console.log(`${checks} trade notification checks passed.`);
} finally {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.SLEEPER_TOKEN; else process.env.SLEEPER_TOKEN = originalToken;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  PERIOD_MINUTES, addBot, closePeriod, createGame, joinGame, nextDailyDeadline, runDeadlines, startGame, submitDecisions, viewFor,
} from '../src/game.js';
import { MemoryStore, RedisStore } from '../src/store.js';
import { createServer } from '../server.js';

const never = () => false;

test('partida ao vivo: fecha o período quando todos os humanos enviam', () => {
  const { game, player: host } = createGame(never, { name: 'Ana', companyName: 'Alfa', totalPeriods: 3, mode: 'live' });
  const bia = joinGame(game, { name: 'Bia', companyName: 'Beta' });
  addBot(game, host, 'agressiva');
  startGame(game, host);
  assert.equal(game.status, 'running');
  assert.equal(game.period, 1);

  submitDecisions(game, host, { period: 1, decisions: { price: 65 } });
  assert.equal(game.period, 1, 'não deve fechar antes de todos enviarem');
  submitDecisions(game, bia, { period: 1, decisions: { price: 55 } });
  assert.equal(game.period, 2);
  assert.equal(game.history.length, 1);
  assert.equal(game.history[0].reports[host.id].decisions.price, 65);

  closePeriod(game); // anfitrião força: quem não enviou repete as decisões anteriores
  assert.deepEqual(game.history[1].autoSubmitted.sort(), [host.id, bia.id].sort());
  assert.equal(game.history[1].reports[bia.id].decisions.price, 55);

  closePeriod(game);
  assert.equal(game.status, 'finished');
  assert.throws(() => submitDecisions(game, host, { period: 3, decisions: {} }));
});

test('não aceita decisões de período já fechado nem entrada após o início', () => {
  const { game, player: host } = createGame(never, { name: 'Ana', companyName: 'Alfa', totalPeriods: 3, mode: 'live' });
  addBot(game, host, 'equilibrada');
  startGame(game, host);
  assert.throws(() => submitDecisions(game, host, { period: 2, decisions: {} }), /período já foi fechado/);
  assert.throws(() => joinGame(game, { name: 'X', companyName: 'Xis' }), /já começou/);
});

test('nomes de empresa repetidos são recusados', () => {
  const { game } = createGame(never, { name: 'Ana', companyName: 'Alfa', totalPeriods: 3, mode: 'live' });
  assert.throws(() => joinGame(game, { name: 'Bia', companyName: 'alfa' }), /Já existe/);
});

test('modo diário fecha no horário e respeita intervalo mínimo', () => {
  // 10:00 UTC, fuso de Brasília (UTC−3 → offset 180): 22h local = 01:00 UTC do dia seguinte
  const now = Date.UTC(2026, 0, 10, 10, 0);
  const deadline = nextDailyDeadline(22, 180, now);
  assert.equal(deadline, Date.UTC(2026, 0, 11, 1, 0));
  // às 21:30 local o próximo prazo vira o do dia seguinte
  const late = Date.UTC(2026, 0, 11, 0, 30);
  assert.equal(nextDailyDeadline(22, 180, late), Date.UTC(2026, 0, 12, 1, 0));

  const { game, player: host } = createGame(never, { name: 'Ana', companyName: 'Alfa', totalPeriods: 5, mode: 'daily', dailyCloseHour: 22, tzOffset: 180, closeEarly: false });
  addBot(game, host, 'conservadora');
  startGame(game, host, now);
  submitDecisions(game, host, { period: 1, decisions: {} }, now);
  assert.equal(game.period, 1, 'no modo diário espera o horário');
  assert.equal(runDeadlines(game, deadline - 1), false);
  assert.equal(runDeadlines(game, deadline), true);
  assert.equal(game.period, 2);
});

test('visão do jogador não expõe tokens nem decisões pendentes de outros', () => {
  const { game, player: host } = createGame(never, { name: 'Ana', companyName: 'Alfa', totalPeriods: 3, mode: 'live' });
  const bia = joinGame(game, { name: 'Bia', companyName: 'Beta' });
  startGame(game, host);
  submitDecisions(game, bia, { period: 1, decisions: { price: 99 }, moves: { illegal: ['taxEvasion'], reportTarget: host.id } });
  const json = JSON.stringify(viewFor(game, host));
  assert.ok(!json.includes(host.token) && !json.includes(bia.token));
  assert.ok(!json.includes('"price":99'));
  assert.equal(viewFor(game, bia).myDecisions.price, 99);
  assert.deepEqual(viewFor(game, bia).myMoves.illegal, ['taxEvasion']);

  submitDecisions(game, host, { period: 1, decisions: {} }); // fecha o período
  const hostView = viewFor(game, host);
  assert.equal(hostView.history[0].reports[bia.id].private, undefined, 'práticas de outros ficam ocultas');
  assert.ok(!JSON.stringify(hostView).includes('taxEvasion"]'));
  assert.deepEqual(viewFor(game, bia).history[0].reports[bia.id].private.moves.illegal, ['taxEvasion']);
});

test('anfitrião pode desligar práticas ilegais e aquisições', () => {
  const { game, player: host } = createGame(never, {
    name: 'Ana', companyName: 'Alfa', totalPeriods: 8, mode: 'live', allowIllegal: false, allowAcquisitions: false,
  });
  addBot(game, host, 'agressiva');
  startGame(game, host);
  for (let p = 1; p <= 7; p++) {
    submitDecisions(game, host, { period: p, decisions: {}, moves: { illegal: ['taxEvasion'], acquisitionBid: 9e6 } });
    assert.equal(game.env.acquisition ?? null, null);
  }
  for (const h of game.history) {
    for (const r of Object.values(h.reports)) {
      assert.deepEqual(r.private.moves.illegal, []);
      assert.equal(r.private.moves.acquisitionBid, 0);
    }
  }
});

test('API HTTP: criar, entrar, adicionar robô, começar e jogar', async () => {
  const server = createServer(new MemoryStore());
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  try {
    const created = await call('POST', '/api/games', { name: 'Ana', companyName: 'Alfa', totalPeriods: 3, mode: 'live' });
    assert.equal(created.status, 200);
    const { code, token } = created.data;
    const joined = await call('POST', `/api/games/${code}/join`, { name: 'Bia', companyName: 'Beta' });
    assert.equal((await call('POST', `/api/games/${code}/bots`, { token: joined.data.token, profile: 'agressiva' })).status, 403);
    assert.equal((await call('POST', `/api/games/${code}/bots`, { token, profile: 'agressiva' })).status, 200);
    assert.equal((await call('POST', `/api/games/${code}/start`, { token })).status, 200);
    await call('POST', `/api/games/${code}/decisions`, { token, period: 1, decisions: { price: 61 } });
    await call('POST', `/api/games/${code}/decisions`, { token: joined.data.token, period: 1, decisions: {} });
    const view = await call('GET', `/api/games/${code}?token=${token}`);
    assert.equal(view.data.period, 2);
    assert.equal(view.data.history.length, 1);
    const unchanged = await call('GET', `/api/games/${code}?token=${token}&since=${view.data.version}`);
    assert.equal(unchanged.data.unchanged, true);
    assert.equal((await call('GET', `/api/games/${code}?token=errado`)).status, 403);
    assert.equal((await call('GET', '/api/games/ZZZZZ?token=x')).status, 404);
    const page = await fetch(`${base}/`);
    assert.match(await page.text(), /Simulador de Empresas/);
    assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  } finally {
    server.close();
  }
});

test('modo diário: servidor que dormiu fecha todos os períodos vencidos e mantém o ritmo', () => {
  const now = Date.UTC(2026, 0, 10, 10, 0);
  const { game, player: host } = createGame(never, { name: 'Ana', companyName: 'Alfa', totalPeriods: 5, mode: 'daily', dailyCloseHour: 22, tzOffset: 180 });
  addBot(game, host, 'conservadora');
  startGame(game, host, now);
  const first = game.nextDeadline;
  const day = 24 * 60 * 60 * 1000;
  assert.equal(runDeadlines(game, first + 2 * day + 60_000), true); // acordou 2 dias depois
  assert.equal(game.period, 4);
  assert.equal(game.nextDeadline, first + 3 * day);
});

test('RedisStore grava e recarrega partidas pela API REST do Upstash', async () => {
  const kv = new Map();
  const sets = new Map();
  const run = ([cmd, ...args]) => {
    if (cmd === 'SET') { kv.set(args[0], args[1]); return 'OK'; }
    if (cmd === 'SADD') { const s = sets.get(args[0]) ?? new Set(); s.add(args[1]); sets.set(args[0], s); return 1; }
    if (cmd === 'SMEMBERS') return [...(sets.get(args[0]) ?? [])];
    if (cmd === 'MGET') return args.map((k) => kv.get(k) ?? null);
    throw new Error(`comando inesperado ${cmd}`);
  };
  const calls = [];
  const fakeFetch = async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer segredo');
    const body = JSON.parse(init.body);
    calls.push(url);
    const result = url.endsWith('/pipeline') ? body.map((c) => ({ result: run(c) })) : { result: run(body) };
    return { ok: true, json: async () => result };
  };
  const a = new RedisStore('https://exemplo.upstash.io/', 'segredo', { fetchImpl: fakeFetch });
  await a.load();
  const { game } = createGame(never, { name: 'Ana', companyName: 'Alfa', totalPeriods: 3, mode: 'live' });
  a.add(game);
  game.version = 7;
  a.save(game);
  await a.flush();
  assert.ok(calls.includes('https://exemplo.upstash.io/pipeline'));

  const b = new RedisStore('https://exemplo.upstash.io', 'segredo', { fetchImpl: fakeFetch });
  await b.load();
  assert.equal(b.get(game.code).version, 7);
  assert.equal(b.get(game.code).players[0].companyName, 'Alfa');
});

test('cronômetro: cada período tem prazo; fecha antes se todos enviarem (quando ligado)', () => {
  const now = Date.UTC(2026, 0, 10, 10, 0);
  const min = 60_000;
  const { game, player: host } = createGame(never, { name: 'Ana', companyName: 'Alfa', totalPeriods: 4, mode: 'timer', periodMinutes: 30 });
  const bia = joinGame(game, { name: 'Bia', companyName: 'Beta' });
  startGame(game, host, now);
  assert.equal(game.nextDeadline, now + 30 * min);

  // ninguém enviou: o prazo vence e o período fecha repetindo as decisões
  assert.equal(runDeadlines(game, now + 30 * min), true);
  assert.equal(game.period, 2);
  assert.equal(game.nextDeadline, now + 60 * min);

  // todos enviaram antes do prazo: fecha na hora e o novo prazo conta a partir daí
  submitDecisions(game, host, { period: 2, decisions: {} }, now + 40 * min);
  submitDecisions(game, bia, { period: 2, decisions: {} }, now + 45 * min);
  assert.equal(game.period, 3);
  assert.equal(game.nextDeadline, now + 75 * min);

  // servidor dormiu 5 horas: fecha só o período vencido e dá um prazo cheio para o próximo
  assert.equal(runDeadlines(game, now + 6 * 60 * min), true);
  assert.equal(game.period, 4);
  assert.equal(game.nextDeadline, now + 6 * 60 * min + 30 * min);
});

test('cronômetro sem fechamento antecipado espera o prazo mesmo com todos prontos', () => {
  const now = Date.UTC(2026, 0, 10, 10, 0);
  const { game, player: host } = createGame(never, { name: 'Ana', companyName: 'Alfa', totalPeriods: 3, mode: 'timer', periodMinutes: 10, closeEarly: false });
  addBot(game, host, 'equilibrada');
  startGame(game, host, now);
  submitDecisions(game, host, { period: 1, decisions: {} }, now + 60_000);
  assert.equal(game.period, 1);
  runDeadlines(game, now + 10 * 60_000);
  assert.equal(game.period, 2);
});

test('prazo inválido é recusado', () => {
  assert.ok(PERIOD_MINUTES.includes(60));
  assert.throws(() => createGame(never, { name: 'A', companyName: 'B', totalPeriods: 3, mode: 'timer', periodMinutes: 7 }), /Prazo/);
});

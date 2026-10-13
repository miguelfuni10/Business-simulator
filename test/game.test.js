import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  addBot, closePeriod, createGame, joinGame, nextDailyDeadline, runDeadlines, startGame, submitDecisions, viewFor,
} from '../src/game.js';
import { Store } from '../src/store.js';
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

  const { game, player: host } = createGame(never, { name: 'Ana', companyName: 'Alfa', totalPeriods: 5, mode: 'daily', dailyCloseHour: 22, tzOffset: 180 });
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
  submitDecisions(game, bia, { period: 1, decisions: { price: 99 } });
  const json = JSON.stringify(viewFor(game, host));
  assert.ok(!json.includes(host.token) && !json.includes(bia.token));
  assert.ok(!json.includes('"price":99'));
  assert.equal(viewFor(game, bia).myDecisions.price, 99);
});

test('API HTTP: criar, entrar, adicionar robô, começar e jogar', async () => {
  const server = createServer(new Store(null));
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

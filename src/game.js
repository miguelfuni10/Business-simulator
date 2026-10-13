// Regras da partida: sala, jogadores, envio de decisões e fechamento de períodos.
import crypto from 'node:crypto';
import {
  CONFIG, DECISIONS, capacityOf, createCompany, createRng, creditLimitOf, defaultDecisions, equityOf,
  generateEnvironment, initialEnvironment, interestRateFor, periodSeed, sanitizeDecisions, simulatePeriod,
} from './engine.js';
import { BOT_COMPANY_NAMES, BOT_PROFILES, botDecisions } from './bots.js';

export const MAX_PLAYERS = 12;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MIN_GAP_BEFORE_DEADLINE_MS = 3 * 60 * 60 * 1000;

export class GameError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const randomId = () => crypto.randomBytes(6).toString('hex');
const randomToken = () => crypto.randomBytes(18).toString('hex');

function cleanText(value, field, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  if (!text) throw new GameError(400, `Preencha o campo "${field}".`);
  return text;
}

function newCode(exists) {
  for (;;) {
    let code = '';
    for (let i = 0; i < 5; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!exists(code)) return code;
  }
}

export function nextDailyDeadline(hour, tzOffsetMinutes, now) {
  // tzOffsetMinutes segue Date#getTimezoneOffset (UTC − horário local).
  const local = new Date(now - tzOffsetMinutes * 60_000);
  let deadline = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour) + tzOffsetMinutes * 60_000;
  while (deadline - now < MIN_GAP_BEFORE_DEADLINE_MS) deadline += 24 * 60 * 60 * 1000;
  return deadline;
}

function addPlayer(game, { name, companyName, isBot = false, botProfile = null }) {
  if (game.players.length >= MAX_PLAYERS) throw new GameError(400, `Limite de ${MAX_PLAYERS} empresas por partida.`);
  const taken = new Set(game.players.map((p) => p.companyName.toLowerCase()));
  if (taken.has(companyName.toLowerCase())) throw new GameError(400, 'Já existe uma empresa com esse nome na partida.');
  const player = {
    id: randomId(),
    token: isBot ? null : randomToken(),
    name,
    companyName,
    isHost: game.players.length === 0,
    isBot,
    botProfile,
    joinedAt: Date.now(),
  };
  game.players.push(player);
  return player;
}

export function createGame(exists, input, now = Date.now()) {
  const totalPeriods = Math.round(Number(input.totalPeriods) || 10);
  if (totalPeriods < 3 || totalPeriods > 40) throw new GameError(400, 'O número de períodos deve ficar entre 3 e 40.');
  const mode = input.mode === 'daily' ? 'daily' : 'live';
  const dailyCloseHour = Math.round(Number(input.dailyCloseHour));
  if (mode === 'daily' && !(dailyCloseHour >= 0 && dailyCloseHour <= 23)) {
    throw new GameError(400, 'Escolha um horário de fechamento entre 0h e 23h.');
  }
  const game = {
    code: newCode(exists),
    createdAt: now,
    updatedAt: now,
    version: 1,
    status: 'lobby',
    seed: crypto.randomInt(2 ** 31),
    settings: {
      totalPeriods,
      mode,
      dailyCloseHour: mode === 'daily' ? dailyCloseHour : null,
      tzOffset: Math.round(Number(input.tzOffset) || 0),
    },
    period: 0,
    env: null,
    players: [],
    companies: {},
    pending: {},
    lastDecisions: {},
    history: [],
    nextDeadline: null,
  };
  const host = addPlayer(game, {
    name: cleanText(input.name, 'seu nome', 30),
    companyName: cleanText(input.companyName, 'nome da empresa', 30),
  });
  return { game, player: host };
}

export function authenticate(game, token) {
  const player = token ? game.players.find((p) => p.token === token) : null;
  if (!player) throw new GameError(403, 'Sessão inválida para esta partida.');
  return player;
}

function requireHost(player) {
  if (!player.isHost) throw new GameError(403, 'Só quem criou a partida pode fazer isso.');
}

function touch(game, now = Date.now()) {
  game.version += 1;
  game.updatedAt = now;
}

export function joinGame(game, input) {
  if (game.status !== 'lobby') throw new GameError(400, 'Esta partida já começou.');
  const player = addPlayer(game, {
    name: cleanText(input.name, 'seu nome', 30),
    companyName: cleanText(input.companyName, 'nome da empresa', 30),
  });
  touch(game);
  return player;
}

export function addBot(game, player, profile) {
  requireHost(player);
  if (game.status !== 'lobby') throw new GameError(400, 'A partida já começou.');
  const botProfile = BOT_PROFILES[profile] ? profile : 'equilibrada';
  const used = new Set(game.players.map((p) => p.companyName));
  const companyName = BOT_COMPANY_NAMES.find((n) => !used.has(n)) ?? `Robô ${game.players.length + 1}`;
  const bot = addPlayer(game, { name: `Robô ${BOT_PROFILES[botProfile].label}`, companyName, isBot: true, botProfile });
  touch(game);
  return bot;
}

export function removePlayer(game, player, targetId) {
  requireHost(player);
  if (game.status !== 'lobby') throw new GameError(400, 'Só é possível remover empresas antes do início.');
  const target = game.players.find((p) => p.id === targetId);
  if (!target) throw new GameError(404, 'Empresa não encontrada.');
  if (target.isHost) throw new GameError(400, 'O anfitrião não pode ser removido.');
  game.players = game.players.filter((p) => p.id !== targetId);
  touch(game);
}

export function startGame(game, player, now = Date.now()) {
  requireHost(player);
  if (game.status !== 'lobby') throw new GameError(400, 'A partida já começou.');
  if (game.players.length < 2) throw new GameError(400, 'Chame amigos ou adicione robôs: são necessárias pelo menos 2 empresas.');
  for (const p of game.players) game.companies[p.id] = createCompany(p.id, p.companyName);
  game.status = 'running';
  game.period = 1;
  game.env = initialEnvironment();
  game.nextDeadline = game.settings.mode === 'daily'
    ? nextDailyDeadline(game.settings.dailyCloseHour, game.settings.tzOffset, now)
    : null;
  touch(game, now);
}

export function submitDecisions(game, player, raw, now = Date.now()) {
  if (game.status !== 'running') throw new GameError(400, 'A partida não está em andamento.');
  if (Number(raw?.period) !== game.period) throw new GameError(409, 'O período já foi fechado. Recarregue a página.');
  game.pending[player.id] = sanitizeDecisions(raw?.decisions, game.companies[player.id]);
  touch(game, now);
  const humans = game.players.filter((p) => !p.isBot);
  if (game.settings.mode === 'live' && humans.every((p) => game.pending[p.id])) closePeriod(game, now);
}

export function forceClose(game, player, now = Date.now()) {
  requireHost(player);
  if (game.status !== 'running') throw new GameError(400, 'A partida não está em andamento.');
  closePeriod(game, now);
}

export function closePeriod(game, now = Date.now()) {
  if (game.status !== 'running') return;
  const lastReports = game.history.at(-1)?.reports ?? {};
  const botRng = createRng(periodSeed(game.seed, game.period, 3));
  const decisions = {};
  const autoSubmitted = [];
  for (const p of game.players) {
    const company = game.companies[p.id];
    if (p.isBot) {
      decisions[p.id] = botDecisions(company, game.env, lastReports[p.id], p.botProfile, botRng);
    } else if (game.pending[p.id]) {
      decisions[p.id] = game.pending[p.id];
    } else {
      decisions[p.id] = game.lastDecisions[p.id] ?? defaultDecisions();
      autoSubmitted.push(p.id);
    }
  }
  const companies = game.players.map((p) => game.companies[p.id]);
  const rng = createRng(periodSeed(game.seed, game.period, 1));
  const result = simulatePeriod(companies, decisions, game.env, rng, game.period);
  for (const c of result.companies) game.companies[c.id] = c;
  for (const [id, report] of Object.entries(result.reports)) game.lastDecisions[id] = report.decisions;
  game.history.push({
    period: game.period,
    closedAt: now,
    env: game.env,
    market: result.market,
    reports: result.reports,
    autoSubmitted,
  });
  game.pending = {};
  if (game.period >= game.settings.totalPeriods) {
    game.status = 'finished';
    game.nextDeadline = null;
  } else {
    game.period += 1;
    game.env = generateEnvironment(game.env, createRng(periodSeed(game.seed, game.period, 2)));
    game.nextDeadline = game.settings.mode === 'daily'
      ? nextDailyDeadline(game.settings.dailyCloseHour, game.settings.tzOffset, now)
      : null;
  }
  touch(game, now);
}

/** Fecha períodos de partidas diárias cujo prazo venceu. Retorna true se algo mudou. */
export function runDeadlines(game, now = Date.now()) {
  if (game.status === 'running' && game.nextDeadline && now >= game.nextDeadline) {
    closePeriod(game, now);
    return true;
  }
  return false;
}

function companySnapshot(c) {
  return {
    id: c.id,
    name: c.name,
    cash: c.cash,
    receivables: c.receivables,
    inventoryUnits: c.inventoryUnits,
    inventoryValue: c.inventoryValue,
    fixedAssets: c.fixedAssets,
    capacity: capacityOf(c),
    debt: c.debt,
    equity: equityOf(c),
    creditLimit: creditLimitOf(c),
    shares: c.shares,
    price: c.price,
    cumDividendsPerShare: c.cumDividendsPerShare,
    tsr: (c.price + c.cumDividendsPerShare) / CONFIG.initialPrice - 1,
    marketShare: c.marketShare,
    reputation: c.reputation,
  };
}

/** O que um jogador enxerga. Resultados publicados são públicos (empresas de capital aberto). */
export function viewFor(game, player) {
  const me = player;
  const view = {
    code: game.code,
    version: game.version,
    status: game.status,
    period: game.period,
    settings: game.settings,
    nextDeadline: game.nextDeadline,
    serverTime: Date.now(),
    me: { id: me.id, name: me.name, companyName: me.companyName, isHost: me.isHost },
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      companyName: p.companyName,
      isHost: p.isHost,
      isBot: p.isBot,
      botProfile: p.botProfile,
      submitted: p.isBot || Boolean(game.pending[p.id]),
    })),
    rules: { config: CONFIG, decisions: DECISIONS, botProfiles: BOT_PROFILES },
    history: game.history,
  };
  if (game.status !== 'lobby') {
    view.env = game.env;
    view.companies = Object.fromEntries(Object.values(game.companies).map((c) => [c.id, companySnapshot(c)]));
    view.myDecisions = game.pending[me.id] ?? null;
    view.lastDecisions = game.lastDecisions[me.id] ?? defaultDecisions();
    const myCompany = game.companies[me.id];
    if (myCompany && game.env) {
      view.myInterestRate = interestRateFor(myCompany.debt, equityOf(myCompany), game.env.interestRate);
    }
  }
  return view;
}

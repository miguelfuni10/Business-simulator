// Regras da partida: sala, jogadores, envio de decisões e fechamento de períodos.
import crypto from 'node:crypto';
import {
  ACQUISITION_TARGETS, CARTEL_PRACTICE, CONFIG, DECISIONS, ILLEGAL_PRACTICES, buyingPowerOf, capacityOf, createCompany, createRng,
  creditLimitOf, defaultDecisions, defaultMoves, detectionRisk, equityOf, generateEnvironment, initialEnvironment,
  interestRateFor, periodSeed, sanitizeDecisions, sanitizeMoves, simulatePeriod,
} from './engine.js';
import { BOT_COMPANY_NAMES, BOT_PROFILES, botTurn } from './bots.js';

export const MAX_PLAYERS = 12;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MIN_GAP_BEFORE_DEADLINE_MS = 3 * 60 * 60 * 1000;
export const PERIOD_MINUTES = Object.freeze([5, 10, 15, 30, 60, 120, 240, 480, 720, 1440]);
const DAY_MS = 24 * 60 * 60 * 1000;

export class GameError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const randomId = () => crypto.randomBytes(6).toString('hex');
const randomToken = () => crypto.randomBytes(18).toString('hex');
const PIN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomPin = () => Array.from({ length: 6 }, () => PIN_ALPHABET[crypto.randomInt(PIN_ALPHABET.length)]).join('');
const MAX_RECOVER_FAILS = 10;
const RECOVER_WINDOW_MS = 10 * 60 * 1000;

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
    pin: isBot ? null : randomPin(), // código pessoal para entrar de outro aparelho
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
  // Prazo de cada período: 'timer' (N minutos), 'daily' (todo dia num horário) ou 'live' (sem prazo).
  const mode = ['timer', 'daily', 'live'].includes(input.mode) ? input.mode : 'timer';
  const dailyCloseHour = Math.round(Number(input.dailyCloseHour));
  if (mode === 'daily' && !(dailyCloseHour >= 0 && dailyCloseHour <= 23)) {
    throw new GameError(400, 'Escolha um horário de fechamento entre 0h e 23h.');
  }
  const periodMinutes = Math.round(Number(input.periodMinutes) || 60);
  if (mode === 'timer' && !PERIOD_MINUTES.includes(periodMinutes)) {
    throw new GameError(400, 'Prazo por período inválido.');
  }
  // Sem prazo, o período só pode fechar quando todos enviam (ou pelo anfitrião).
  const closeEarly = mode === 'live' || (input.closeEarly !== false && input.closeEarly !== 'false');
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
      periodMinutes: mode === 'timer' ? periodMinutes : null,
      dailyCloseHour: mode === 'daily' ? dailyCloseHour : null,
      closeEarly,
      tzOffset: Math.round(Number(input.tzOffset) || 0),
      allowAcquisitions: input.allowAcquisitions !== false && input.allowAcquisitions !== 'false',
      allowIllegal: input.allowIllegal !== false && input.allowIllegal !== 'false',
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

/** Partidas criadas antes do código pessoal ganham um na primeira consulta. */
function ensurePins(game) {
  for (const p of game.players) if (!p.isBot && !p.pin) p.pin = randomPin();
}

const normalizePin = (pin) => String(pin ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Entrar de outro aparelho com o código pessoal. Limita tentativas para evitar chutes. */
export function recoverAccess(game, pin, now = Date.now()) {
  ensurePins(game);
  game.recoverFails = (game.recoverFails ?? []).filter((t) => now - t < RECOVER_WINDOW_MS);
  if (game.recoverFails.length >= MAX_RECOVER_FAILS) {
    throw new GameError(429, 'Muitas tentativas erradas. Espere alguns minutos e tente de novo.');
  }
  const wanted = normalizePin(pin);
  const player = wanted.length === 6 ? game.players.find((p) => !p.isBot && p.pin === wanted) : null;
  if (!player) {
    game.recoverFails.push(now);
    throw new GameError(403, 'Código pessoal incorreto. Confira com quem tem o seu link de acesso.');
  }
  return player;
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
  game.nextDeadline = deadlineAfter(game.settings, now);
  touch(game, now);
}

/**
 * Próximo prazo de fechamento. No modo diário, um fechamento pelo relógio (scheduledAt) mantém o ritmo
 * de um período por dia mesmo se o servidor estava dormindo; no modo cronômetro, o prazo conta a partir
 * do fechamento, para ninguém perder a vez porque o servidor acordou atrasado.
 */
function deadlineAfter(settings, now, scheduledAt = null) {
  if (settings.mode === 'daily') {
    return scheduledAt ? scheduledAt + DAY_MS : nextDailyDeadline(settings.dailyCloseHour, settings.tzOffset, now);
  }
  if (settings.mode === 'timer') return now + settings.periodMinutes * 60_000;
  return null;
}

/** Partidas antigas não tinham closeEarly: as "ao vivo" fechavam antes, as diárias não. */
const closesEarly = (settings) => settings.closeEarly ?? settings.mode === 'live';

export function submitDecisions(game, player, raw, now = Date.now()) {
  if (game.status !== 'running') throw new GameError(400, 'A partida não está em andamento.');
  if (Number(raw?.period) !== game.period) throw new GameError(409, 'O período já foi fechado. Recarregue a página.');
  const company = game.companies[player.id];
  game.pending[player.id] = {
    decisions: sanitizeDecisions(raw?.decisions, company),
    moves: sanitizeMoves(raw?.moves, company, game.settings),
    cartel: sanitizeCartelMove(game, player, raw?.moves?.cartel),
  };
  touch(game, now);
  const humans = game.players.filter((p) => !p.isBot);
  if (closesEarly(game.settings) && humans.every((p) => game.pending[p.id])) closePeriod(game, now);
}

// ---------- cartel ----------
const liveCartel = (c) => c.status === 'forming' || c.status === 'active';
const cartelOf = (game, playerId) => (game.cartels ?? []).find((c) => liveCartel(c) && c.members.includes(playerId));

/**
 * Movimento de cartel do jogador neste período:
 * propor (preço mínimo + convidados), aceitar convite, sair ou delatar.
 */
function sanitizeCartelMove(game, player, raw) {
  if (!raw || game.settings.allowIllegal === false) return null;
  const mine = cartelOf(game, player.id);
  if (raw.type === 'propose' && !mine) {
    const price = Math.round(Number(raw.price) * 100) / 100;
    const others = new Set(game.players.filter((p) => p.id !== player.id).map((p) => p.id));
    const invite = [...new Set(Array.isArray(raw.invite) ? raw.invite : [])].filter((id) => others.has(id));
    if (!(price >= 10 && price <= 200)) throw new GameError(400, 'Preço mínimo do cartel inválido.');
    if (!invite.length) throw new GameError(400, 'Convide pelo menos uma empresa para o cartel.');
    return { type: 'propose', price, invite };
  }
  if (raw.type === 'accept' && !mine) {
    const c = (game.cartels ?? []).find((x) => x.id === raw.cartelId && liveCartel(x) && x.invited.includes(player.id));
    return c ? { type: 'accept', cartelId: c.id } : null;
  }
  if ((raw.type === 'leave' || raw.type === 'delate') && mine) {
    return { type: raw.type, cartelId: mine.id };
  }
  return null;
}

/** Atualiza os cartéis depois do fechamento: desmantelados, saídas, novos membros e propostas. */
function updateCartels(game, cartelMoves, market, period) {
  game.cartels ??= [];
  for (const c of game.cartels.filter((x) => x.status === 'active')) {
    const result = market.cartels.find((r) => r.id === c.id);
    if (result) {
      c.status = 'exposed';
      c.endedPeriod = period;
      c.byDelation = result.byDelation;
      c.delators = result.delators;
    } else {
      c.periods += 1;
    }
  }
  for (const [playerId, mv] of Object.entries(cartelMoves)) {
    const c = game.cartels.find((x) => x.id === mv.cartelId && liveCartel(x));
    if (mv.type === 'leave' && c) c.members = c.members.filter((id) => id !== playerId);
    if (mv.type === 'accept' && c && !cartelOf(game, playerId)) {
      c.members.push(playerId);
      c.invited = c.invited.filter((id) => id !== playerId);
    }
  }
  for (const [playerId, mv] of Object.entries(cartelMoves)) {
    if (mv.type === 'propose' && !cartelOf(game, playerId)) {
      game.cartels.push({
        id: `C${period}-${playerId}`,
        founderId: playerId,
        price: mv.price,
        members: [playerId],
        invited: mv.invite,
        status: 'forming',
        createdPeriod: period,
        periods: 0,
      });
    }
  }
  for (const c of game.cartels.filter(liveCartel)) {
    if (c.members.length >= 2) c.status = 'active';
    else if (c.status === 'active' || c.members.length === 0) { c.status = 'dissolved'; c.endedPeriod = period; }
  }
}

/**
 * Projeção do período para um jogador: roda o motor sem sorte/azar, supondo que os concorrentes
 * repitam as decisões do último período (que são públicas). Não usa as decisões pendentes de ninguém.
 */
export function previewDecisions(game, player, raw) {
  if (game.status !== 'running') throw new GameError(400, 'A partida não está em andamento.');
  const decisions = {};
  const moves = {};
  for (const p of game.players) {
    decisions[p.id] = game.lastDecisions[p.id] ?? defaultDecisions();
    moves[p.id] = defaultMoves();
  }
  const company = game.companies[player.id];
  decisions[player.id] = sanitizeDecisions(raw?.decisions, company);
  moves[player.id] = { ...defaultMoves(), illegal: sanitizeMoves(raw?.moves, company, game.settings).illegal };
  const companies = game.players.map((p) => game.companies[p.id]);
  const { reports } = simulatePeriod(companies, decisions, game.env, createRng(1), game.period, moves, { deterministic: true });
  const r = reports[player.id];
  return {
    period: game.period,
    operations: {
      demand: r.operations.demand,
      sales: r.operations.sales,
      unmet: r.operations.unmet,
      marketShare: r.operations.marketShare,
      inventoryUnits: r.operations.inventoryUnits,
      unitCost: r.operations.unitCost,
    },
    income: {
      revenue: r.income.revenue,
      grossProfit: r.income.grossProfit,
      ebit: r.income.ebit,
      netIncome: r.income.netIncome,
    },
    balance: { cash: r.balance.cash, debt: r.balance.debt, equity: r.balance.equity },
    emergencyLoan: r.cashflow.emergencyLoan,
    stock: { price: r.stock.price, change: r.stock.change },
  };
}

export function forceClose(game, player, now = Date.now()) {
  requireHost(player);
  if (game.status !== 'running') throw new GameError(400, 'A partida não está em andamento.');
  closePeriod(game, now);
}

export function closePeriod(game, now = Date.now(), { scheduledAt = null } = {}) {
  if (game.status !== 'running') return;
  const lastReports = game.history.at(-1)?.reports ?? {};
  const botRng = createRng(periodSeed(game.seed, game.period, 3));
  const decisions = {};
  const moves = {};
  const autoSubmitted = [];
  for (const p of game.players) {
    const company = game.companies[p.id];
    if (p.isBot) {
      ({ decisions: decisions[p.id], moves: moves[p.id] } = botTurn(
        company, game.env, lastReports[p.id], p.botProfile, botRng, game.settings,
      ));
    } else if (game.pending[p.id]) {
      decisions[p.id] = game.pending[p.id].decisions;
      moves[p.id] = game.pending[p.id].moves;
    } else {
      // Quem não envia repete as 10 decisões, mas nunca lances nem práticas ilegais.
      decisions[p.id] = game.lastDecisions[p.id] ?? defaultDecisions();
      moves[p.id] = defaultMoves();
      autoSubmitted.push(p.id);
    }
  }
  const companies = game.players.map((p) => game.companies[p.id]);
  const rng = createRng(periodSeed(game.seed, game.period, 1));
  const cartelMoves = Object.fromEntries(game.players
    .filter((p) => game.pending[p.id]?.cartel)
    .map((p) => [p.id, game.pending[p.id].cartel]));
  const cartels = (game.cartels ?? []).filter((c) => c.status === 'active').map((c) => ({
    id: c.id,
    members: c.members,
    periods: c.periods,
    delators: c.members.filter((id) => cartelMoves[id]?.type === 'delate'),
  }));
  const result = simulatePeriod(companies, decisions, game.env, rng, game.period, moves, {
    finalPeriod: game.period >= game.settings.totalPeriods,
    cartels,
  });
  updateCartels(game, cartelMoves, result.market, game.period);
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
    game.env = generateEnvironment(game.env, createRng(periodSeed(game.seed, game.period, 2)), game.period, {
      allowAcquisitions: game.settings.allowAcquisitions !== false,
    });
    game.nextDeadline = deadlineAfter(game.settings, now, scheduledAt);
  }
  touch(game, now);
}

/** Fecha períodos de partidas diárias cujo prazo venceu. Retorna true se algo mudou. */
export function runDeadlines(game, now = Date.now()) {
  let changed = false;
  // Fecha todos os períodos vencidos (o servidor pode ter ficado dormindo vários dias).
  while (game.status === 'running' && game.nextDeadline && now >= game.nextDeadline) {
    closePeriod(game, now, { scheduledAt: game.nextDeadline });
    changed = true;
  }
  return changed;
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
    goodwill: c.goodwill || 0,
    capacity: capacityOf(c),
    acquiredCustomers: c.acquiredCustomers || 0,
    acquisitions: c.acquisitions ?? [],
    underInvestigation: (c.investigation || 0) > 0,
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

/** O que o jogador sabe sobre cartéis: convites recebidos, o seu cartel e a fidelidade dos parceiros. */
function cartelViewFor(game, me) {
  const name = (id) => game.players.find((p) => p.id === id)?.companyName ?? '?';
  const live = (game.cartels ?? []).filter(liveCartel);
  const mine = live.find((c) => c.members.includes(me.id));
  const last = game.history.at(-1);
  return {
    pendingMove: game.pending[me.id]?.cartel ?? null,
    invites: mine ? [] : live.filter((c) => c.invited.includes(me.id)).map((c) => ({
      id: c.id, founder: name(c.founderId), price: c.price, members: c.members.map(name),
    })),
    membership: mine && {
      id: mine.id,
      price: mine.price,
      status: mine.status,
      periods: mine.periods,
      founder: name(mine.founderId),
      members: mine.members.map((id) => ({
        id,
        name: name(id),
        lastPrice: last?.reports[id]?.decisions.price ?? null,
      })),
      invited: mine.invited.map(name),
    },
  };
}

/** O que um jogador enxerga. Resultados publicados são públicos (empresas de capital aberto). */
export function viewFor(game, player) {
  const me = player;
  ensurePins(game);
  const view = {
    code: game.code,
    version: game.version,
    status: game.status,
    period: game.period,
    settings: game.settings,
    nextDeadline: game.nextDeadline,
    serverTime: Date.now(),
    me: { id: me.id, name: me.name, companyName: me.companyName, isHost: me.isHost, pin: me.pin },
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      companyName: p.companyName,
      isHost: p.isHost,
      isBot: p.isBot,
      botProfile: p.botProfile,
      submitted: p.isBot || Boolean(game.pending[p.id]),
    })),
    rules: {
      config: CONFIG,
      decisions: DECISIONS,
      botProfiles: BOT_PROFILES,
      illegalPractices: ILLEGAL_PRACTICES,
      cartelPractice: CARTEL_PRACTICE,
      acquisitionTargets: ACQUISITION_TARGETS,
    },
    history: game.history.map((h) => ({
      ...h,
      reports: Object.fromEntries(Object.entries(h.reports).map(([id, r]) => {
        if (id === me.id) return [id, r];
        const { private: _hidden, ...pub } = r;
        return [id, pub];
      })),
    })),
  };
  if (game.status !== 'lobby') {
    view.env = game.env;
    view.companies = Object.fromEntries(Object.values(game.companies).map((c) => [c.id, companySnapshot(c)]));
    view.myDecisions = game.pending[me.id]?.decisions ?? null;
    view.myMoves = game.pending[me.id]?.moves ?? null;
    view.lastDecisions = game.lastDecisions[me.id] ?? defaultDecisions();
    const myCompany = game.companies[me.id];
    if (myCompany && game.env) {
      view.myInterestRate = interestRateFor(myCompany.debt, equityOf(myCompany), game.env.interestRate);
      view.myBuyingPower = buyingPowerOf(myCompany);
      view.myCartel = cartelViewFor(game, me);
      view.myIllegal = {
        investigation: myCompany.investigation || 0,
        practices: Object.fromEntries(ILLEGAL_PRACTICES.map((pr) => {
          const st = myCompany.illegal?.[pr.key] ?? { streak: 0, exposure: 0 };
          const finalBoost = game.period >= game.settings.totalPeriods ? CONFIG.finalAuditRisk : 0;
          return [pr.key, {
            streak: st.streak,
            exposure: st.exposure,
            riskIfActive: Math.min(0.95, detectionRisk(myCompany, pr.key, true) + finalBoost),
            riskIfIdle: st.exposure > 0 ? Math.min(0.95, detectionRisk(myCompany, pr.key, false) + finalBoost) : 0,
          }];
        })),
      };
    }
  }
  return view;
}

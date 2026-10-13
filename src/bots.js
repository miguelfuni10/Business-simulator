// Concorrentes controlados pelo computador, para completar a mesa.
import { CONFIG, capacityOf, clamp, creditLimitOf, defaultDecisions, defaultMoves, equityOf } from './engine.js';

export const BOT_PROFILES = Object.freeze({
  conservadora: {
    label: 'Conservadora', price: 62, buffer: 0.02, marketing: 40_000, rnd: 25_000,
    growth: 1.0, salary: 95, creditDays: 30, payout: 0.5,
    acquisitionPremium: null, shady: 0,
  },
  equilibrada: {
    label: 'Equilibrada', price: 60, buffer: 0.06, marketing: 55_000, rnd: 35_000,
    growth: 1.15, salary: 100, creditDays: 30, payout: 0.25,
    acquisitionPremium: 1.05, shady: 0,
  },
  agressiva: {
    label: 'Agressiva', price: 56, buffer: 0.1, marketing: 80_000, rnd: 30_000,
    growth: 1.5, salary: 105, creditDays: 60, payout: 0,
    acquisitionPremium: 1.2, shady: 0.3,
  },
  inovadora: {
    label: 'Inovadora', price: 64, buffer: 0.05, marketing: 45_000, rnd: 70_000,
    growth: 1.2, salary: 115, creditDays: 30, payout: 0.1,
    acquisitionPremium: 1.1, shady: 0, prefers: 'Tecnologia',
  },
});

export const BOT_COMPANY_NAMES = [
  'Aurora Indústrias', 'Titã S.A.', 'Bem-te-vi Ltda.', 'Ipê Holding', 'Jaguar Corp.',
  'Maré Alta S.A.', 'Cerrado Tech', 'Pororoca Group', 'Sabiá Manufatura', 'Vento Sul S.A.',
  'Carcará Comércio', 'Ouro Preto Ind.',
];

/**
 * @param company estado atual da empresa
 * @param env cenário anunciado do período
 * @param lastReport relatório do período anterior (ou undefined)
 * @param profileKey perfil do bot
 * @param rng gerador aleatório
 */
export function botDecisions(company, env, lastReport, profileKey, rng) {
  const P = BOT_PROFILES[profileKey] ?? BOT_PROFILES.equilibrada;
  const d = defaultDecisions();
  const jitter = (x, pct) => x * (1 + (rng() * 2 - 1) * pct);
  const capacity = capacityOf(company);

  const lastDemand = lastReport?.operations.demand ?? CONFIG.baseDemandPerCompany;
  const expected = (0.6 * lastDemand + 0.4 * CONFIG.baseDemandPerCompany) * env.demandMult;
  d.production = Math.round(clamp(expected * (1 + P.buffer) - company.inventoryUnits * 0.8, 0, capacity) / 100) * 100;

  let price = lastReport?.decisions.price ?? P.price;
  const stockRatio = company.inventoryUnits / Math.max(expected, 1);
  if (stockRatio > 0.3) price -= 2;
  else if (lastReport && lastReport.operations.unmet > lastReport.operations.demand * 0.05) price += 2;
  else price += (P.price - price) * 0.3;
  price *= 0.6 + 0.4 * env.materialMult; // repassa parte do custo dos insumos
  d.price = Math.round(clamp(jitter(price, 0.02), P.price - 10, P.price + 15));

  d.marketing = Math.round(jitter(P.marketing, 0.1) / 1000) * 1000;
  d.rnd = Math.round(jitter(P.rnd, 0.1) / 1000) * 1000;
  const depreciation = company.fixedAssets * CONFIG.depreciationRate;
  const utilization = lastReport?.operations.utilization ?? 0.85;
  d.capex = Math.round((depreciation * (utilization > 0.9 ? P.growth : 1)) / 1000) * 1000;
  d.salary = P.salary;
  d.creditDays = P.creditDays;

  d.loan = 0;
  if (company.cash < 120_000) {
    d.loan = Math.max(0, Math.min(200_000, creditLimitOf(company) - company.debt));
  } else if (company.cash > 450_000 && company.debt > 0) {
    d.loan = -Math.round(Math.min(company.debt, company.cash - 350_000));
  }
  const lastNI = lastReport?.income.netIncome ?? 0;
  d.dividends = lastNI > 0 && company.cash > 250_000 ? Math.round((lastNI * P.payout) / 1000) * 1000 : 0;
  d.shares = 0;
  return d;
}

/** Movimentos estratégicos dos robôs: lances em aquisições e, para alguns, atalhos ilegais. */
export function botMoves(company, env, profileKey, rng, { allowIllegal = true } = {}) {
  const P = BOT_PROFILES[profileKey] ?? BOT_PROFILES.equilibrada;
  const moves = defaultMoves();
  const target = env.acquisition;
  if (target && P.acquisitionPremium) {
    const interested = !P.prefers || P.prefers === target.kind || rng() < 0.35;
    const bid = Math.round((target.minBid * P.acquisitionPremium * (0.95 + rng() * 0.15)) / 10_000) * 10_000;
    const room = Math.max(0, creditLimitOf(company) - company.debt);
    const healthy = company.debt < 0.8 * equityOf(company);
    if (interested && healthy && bid <= 0.5 * (Math.max(0, company.cash) + room)) moves.acquisitionBid = bid;
  }
  if (allowIllegal && P.shady > 0 && company.investigation === 0 && rng() < P.shady) {
    moves.illegal = [rng() < 0.5 ? 'informalLabor' : 'illegalDumping'];
  }
  return moves;
}

/** Rodada completa de um robô: decisões + movimentos, já financiando o lance de aquisição. */
export function botTurn(company, env, lastReport, profileKey, rng, options) {
  const decisions = botDecisions(company, env, lastReport, profileKey, rng);
  const moves = botMoves(company, env, profileKey, rng, options);
  if (moves.acquisitionBid > 0) {
    const room = Math.max(0, creditLimitOf(company) - company.debt);
    decisions.loan = Math.max(decisions.loan, Math.min(room, moves.acquisitionBid));
  }
  return { decisions, moves };
}

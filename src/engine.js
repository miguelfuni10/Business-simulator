// Motor de simulação: mercado compartilhado, contabilidade (DRE, balanço,
// fluxo de caixa) e precificação da ação. Funções puras e determinísticas
// dado o mesmo gerador de números aleatórios.

export const CONFIG = Object.freeze({
  initialShares: 100_000,
  initialPrice: 10,
  initialCash: 200_000,
  initialReceivables: 200_000,
  initialInventoryUnits: 2_000,
  initialUnitCost: 35,
  initialFixedAssets: 840_000,
  initialDebt: 310_000,
  capitalPerUnit: 70, // R$ de imobilizado por unidade de capacidade
  depreciationRate: 0.05,
  baseDemandPerCompany: 10_000,
  refPrice: 60,
  marketPriceElasticity: 2,
  sharePriceElasticity: 2.2,
  materialCost: 20,
  laborCost: 15,
  adminFixed: 40_000,
  adminSalaryLinked: 20_000,
  inventoryCarryCost: 2,
  badDebtPer30Days: 0.008,
  taxRate: 0.34,
  baseInterest: 0.03,
  minCreditLimit: 200_000,
  creditLimitToEquity: 1.5,
  costOfEquity: 0.035,
  brandRetention: 0.65,
  qualityRetention: 0.85,
  periodDays: 90,
  emergencyFeeRate: 0.08,
  issueDiscount: 0.05,
  buybackPremium: 0.02,
  maxBuybackPct: 0.1,
  maxIssuePct: 0.5,
  valuationMultiplier: 6,
  baselineMarketing: 50_000,
  baselineRnd: 30_000,
  cashYieldShare: 0.5, // caixa aplicado rende metade da taxa básica
  acquisitionChance: 0.65, // chance de surgir uma empresa à venda em cada período (a partir do 2º)
  customerChurn: 0.05, // clientes herdados de aquisições que se perdem por período
  reportCost: 20_000, // custo jurídico de uma denúncia
  reportReward: 60_000, // recompensa quando a denúncia leva a uma condenação
  falseReportIndemnity: 50_000, // denúncia contra empresa honesta: indenização paga ao denunciado
  falseReportReputationHit: 0.05, // ...e o denunciante perde reputação (e é exposto nas notícias)
  reportDetectionBoost: 0.3, // chance extra de detecção por denúncia recebida
  fineMultiplier: 3, // multa = 3× o ganho ilícito acumulado + multa fixa
  fixedFine: 100_000,
  repeatOffenderMultiplier: 2, // reincidente paga multa dobrada
  investigationPeriods: 4, // períodos sob investigação após ser pego (risco 1,5×)
  governanceDiscount: 0.03, // cada condenação tira 3% do valor da ação para sempre (máx. 15%)
  accountingFraudBoost: 0.04, // lucro fictício: 4% da receita
  cartelGainShare: 0.05, // vantagem indevida do cartel (base da multa): 5% da receita por período
  finalAuditRisk: 0.25, // risco extra de detecção no último período (auditoria de encerramento)
});

const BASE_BRAND = CONFIG.baselineMarketing / (1 - CONFIG.brandRetention);
const BASE_QUALITY = CONFIG.baselineRnd / (1 - CONFIG.qualityRetention);
// Suavizam o efeito de marca/qualidade perto de zero (retornos decrescentes).
const BRAND_SOFTENER = 0.5 * BASE_BRAND;
const QUALITY_SOFTENER = 0.5 * BASE_QUALITY;

export const DECISIONS = Object.freeze([
  {
    key: 'price', label: 'Preço de venda', unit: 'R$/un.', min: 10, max: 200, step: 1, default: 60,
    help: 'Preço por unidade. Abaixo da média do mercado atrai clientes dos concorrentes, mas reduz a margem. Se todos sobem o preço, o mercado inteiro encolhe.',
  },
  {
    key: 'production', label: 'Produção', unit: 'unidades', min: 0, max: 1_000_000, step: 100, default: 10_000,
    help: 'Unidades a fabricar, limitadas pela capacidade da fábrica. O que sobra vira estoque (custa R$ 2/un. por período); faltar produto faz perder vendas e reputação.',
  },
  {
    key: 'marketing', label: 'Marketing', unit: 'R$', min: 0, max: 5_000_000, step: 5_000, default: 50_000,
    help: 'Constrói a força da marca. O efeito se acumula, mas se desgasta 35% a cada período.',
  },
  {
    key: 'rnd', label: 'Pesquisa & Desenvolvimento', unit: 'R$', min: 0, max: 5_000_000, step: 5_000, default: 30_000,
    help: 'Melhora a qualidade do produto. Efeito lento e duradouro (desgaste de 15% por período).',
  },
  {
    key: 'capex', label: 'Investimento na fábrica', unit: 'R$', min: 0, max: 10_000_000, step: 10_000, default: 42_000,
    help: 'Cada R$ 70 investidos geram 1 unidade de capacidade a partir do próximo período. A depreciação (5%/período) reduz a capacidade se você não reinvestir.',
  },
  {
    key: 'salary', label: 'Nível salarial', unit: '% do mercado', min: 70, max: 150, step: 5, default: 100,
    help: 'Salários maiores aumentam a produtividade e a qualidade do atendimento, mas encarecem mão de obra e administração.',
  },
  {
    key: 'creditDays', label: 'Prazo de pagamento aos clientes', unit: 'dias', min: 0, max: 90, step: 30, default: 30,
    help: 'Prazo maior atrai clientes, mas a parte a prazo só entra no caixa no período seguinte e aumenta a inadimplência.',
  },
  {
    key: 'loan', label: 'Empréstimo (+) / amortização (−)', unit: 'R$', min: -100_000_000, max: 100_000_000, step: 10_000, default: 0,
    help: 'Positivo toma dívida; negativo paga dívida. O juro depende da taxa básica e da sua alavancagem. Limite: 1,5× o patrimônio líquido.',
  },
  {
    key: 'dividends', label: 'Dividendos', unit: 'R$ (total)', min: 0, max: 100_000_000, step: 5_000, default: 0,
    help: 'Dinheiro devolvido aos acionistas. Conta na valorização total da ação, mas reduz caixa e patrimônio.',
  },
  {
    key: 'shares', label: 'Emissão (+) / recompra (−) de ações', unit: 'ações', min: -1_000_000, max: 1_000_000, step: 1_000, default: 0,
    help: 'Emitir levanta caixa (com 5% de desconto sobre a cotação) e dilui os sócios. Recomprar (até 10% por período, com 2% de prêmio) devolve caixa e concentra o lucro.',
  },
]);

export const EVENTS = Object.freeze([
  { title: 'Boom de consumo', text: 'Confiança do consumidor em alta: a demanda deve crescer bastante neste período.', effects: { demand: 0.12 } },
  { title: 'Recessão à vista', text: 'Indicadores apontam desaceleração. Os consumidores estão segurando as compras.', effects: { demand: -0.12 } },
  { title: 'Alta das commodities', text: 'O preço das matérias-primas disparou no mercado internacional.', effects: { material: 0.15 } },
  { title: 'Matéria-prima mais barata', text: 'Supersafra e câmbio favorável derrubam o custo dos insumos.', effects: { material: -0.1 } },
  { title: 'Banco Central sobe os juros', text: 'Para conter a inflação, a taxa básica de juros subiu.', effects: { interest: 0.01 } },
  { title: 'Corte de juros', text: 'O Banco Central reduziu a taxa básica. Crédito mais barato!', effects: { interest: -0.008 } },
  { title: 'Greve dos caminhoneiros', text: 'Paralisação afeta a logística: insumos mais caros e consumo em queda.', effects: { demand: -0.06, material: 0.08 } },
  { title: 'Feriado prolongado', text: 'Datas comemorativas devem aquecer as vendas.', effects: { demand: 0.06 } },
  { title: 'Nova regulação ambiental', text: 'Exigências ambientais aumentam o custo de produção.', effects: { material: 0.05 } },
  { title: 'Euforia na bolsa', text: 'Investidores estrangeiros chegam com tudo: o mercado de ações está otimista.', effects: { sentiment: 0.04 } },
  { title: 'Pânico no mercado', text: 'Crise lá fora derruba as bolsas do mundo inteiro.', effects: { sentiment: -0.05, demand: -0.03 } },
]);

// Práticas ilegais: ganho imediato, mas cada período em uso aumenta o risco de
// ser descoberto. Ganhos não punidos continuam expostos mesmo depois de parar.
export const ILLEGAL_PRACTICES = Object.freeze([
  {
    key: 'taxEvasion', label: 'Sonegação de impostos',
    benefit: 'Não paga IR/CSLL neste período.',
    risk: 'A Receita cruza dados: quanto mais tempo, maior o risco.',
    baseRisk: 0.1, streakRisk: 0.05, shock: 0.2, reputationHit: 0.05,
  },
  {
    key: 'informalLabor', label: 'Trabalho informal',
    benefit: 'Mão de obra 30% mais barata.',
    risk: 'Fiscalização do trabalho e ações trabalhistas; os clientes não gostam.',
    baseRisk: 0.1, streakRisk: 0.05, shock: 0.2, reputationHit: 0.2,
  },
  {
    key: 'illegalDumping', label: 'Descarte ilegal de resíduos',
    benefit: 'Economiza R$ 3 por unidade produzida.',
    risk: 'Crime ambiental: multa pesada e manchete negativa.',
    baseRisk: 0.08, streakRisk: 0.05, shock: 0.2, reputationHit: 0.15,
  },
  {
    key: 'falseAdvertising', label: 'Propaganda enganosa',
    benefit: 'Cada real de marketing rende o dobro em força de marca.',
    risk: 'Procon e concorrentes ficam de olho. Se pego, a marca perde 40%.',
    baseRisk: 0.12, streakRisk: 0.05, shock: 0.15, reputationHit: 0.12, brandHit: 0.4,
  },
  {
    key: 'espionage', label: 'Espionagem industrial',
    benefit: 'Copia o equivalente a 30% do P&D médio dos concorrentes.',
    risk: 'Ex-funcionários costumam falar.',
    baseRisk: 0.08, streakRisk: 0.06, shock: 0.15, reputationHit: 0.08,
  },
  {
    key: 'accountingFraud', label: 'Maquiagem contábil',
    benefit: 'Os investidores enxergam um lucro maior (4% da receita) e a ação sobe.',
    risk: 'Auditoria e CVM. Se descoberta, a ação desaba ~40%.',
    baseRisk: 0.08, streakRisk: 0.07, shock: 0.4, reputationHit: 0.08,
  },
]);
// Cartel: prática em grupo. Não é marcada como as outras; nasce de uma proposta aceita entre empresas.
export const CARTEL_PRACTICE = Object.freeze({
  key: 'cartel', label: 'Cartel de preços',
  benefit: 'Concorrentes combinam um preço mínimo e todos lucram mais, se ninguém furar o acordo.',
  risk: 'O CADE investiga; qualquer membro pode delatar os outros em troca de imunidade.',
  baseRisk: 0.08, streakRisk: 0.05, shock: 0.2, reputationHit: 0.08,
});
const PRACTICE_KEYS = new Set(ILLEGAL_PRACTICES.map((x) => x.key));
const practiceByKey = Object.fromEntries([...ILLEGAL_PRACTICES, CARTEL_PRACTICE].map((x) => [x.key, x]));

// Empresas que podem aparecer à venda. Valores são multiplicados por um fator aleatório.
export const ACQUISITION_TARGETS = Object.freeze([
  {
    name: 'Fábrica Regional Paraná', kind: 'Capacidade',
    text: 'Fábrica moderna e mão de obra treinada. Aumenta a capacidade a partir do próximo período.',
    fixedAssets: 350_000, customers: 0, brand: 0, quality: 20_000, discount: 0.9,
  },
  {
    name: 'Marca Sol Nascente', kind: 'Clientes e marca',
    text: 'Marca regional querida, com clientela fiel. Traz clientes próprios e força de marca.',
    fixedAssets: 140_000, customers: 2_500, brand: 80_000, quality: 0, discount: 0.9,
  },
  {
    name: 'Startup InovaLab', kind: 'Tecnologia',
    text: 'Laboratório com patentes que melhoram a qualidade do produto.',
    fixedAssets: 35_000, customers: 0, brand: 10_000, quality: 170_000, discount: 0.85,
  },
  {
    name: 'Distribuidora Rota Norte', kind: 'Clientes',
    text: 'Rede de distribuição com carteira de clientes no Norte do país.',
    fixedAssets: 70_000, customers: 1_800, brand: 20_000, quality: 0, discount: 0.9,
  },
  {
    name: 'Concorrente em recuperação judicial', kind: 'Barganha',
    text: 'Vendida às pressas: fábrica e alguns clientes, mas a marca está arranhada.',
    fixedAssets: 420_000, customers: 1_200, brand: 0, quality: 0, discount: 0.65,
  },
]);

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round2 = (x) => Math.round(x * 100) / 100;
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export function periodSeed(seed, period, salt) {
  return (seed ^ Math.imul(period + 1, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0;
}

export const capacityOf = (c) => Math.floor(c.fixedAssets / CONFIG.capitalPerUnit);

export const equityOf = (c) =>
  c.cash + c.receivables + c.inventoryValue + c.fixedAssets + (c.goodwill || 0) - c.debt;

export const creditLimitOf = (c) => Math.max(CONFIG.minCreditLimit, CONFIG.creditLimitToEquity * equityOf(c));

/** Quanto a empresa consegue pagar numa aquisição: caixa, recebíveis e crédito disponível. */
export const buyingPowerOf = (c) => Math.max(0, c.cash + c.receivables + Math.max(0, creditLimitOf(c) - c.debt));

export function interestRateFor(debt, equity, baseRate) {
  const leverage = equity > 0 ? debt / equity : Infinity;
  return baseRate + Math.min(0.05, 0.01 * Math.max(0, leverage - 0.5));
}

export function defaultDecisions() {
  return Object.fromEntries(DECISIONS.map((d) => [d.key, d.default]));
}

/** Movimentos estratégicos opcionais (fora das 10 decisões): aquisição, bastidores e denúncia. */
export function defaultMoves() {
  return { acquisitionBid: 0, illegal: [], reportTarget: null };
}

export function createCompany(id, name) {
  const C = CONFIG;
  const company = {
    id,
    name,
    cash: C.initialCash,
    receivables: C.initialReceivables,
    inventoryUnits: C.initialInventoryUnits,
    inventoryValue: C.initialInventoryUnits * C.initialUnitCost,
    fixedAssets: C.initialFixedAssets,
    goodwill: 0,
    debt: C.initialDebt,
    shares: C.initialShares,
    price: C.initialPrice,
    brand: BASE_BRAND,
    quality: BASE_QUALITY,
    reputation: 1,
    acquiredCustomers: 0,
    acquisitions: [],
    illegal: {},
    investigation: 0,
    convictions: 0,
    lossCarryforward: 0,
    lastAdjNI: 0,
    lastRevenue: C.baseDemandPerCompany * C.refPrice,
    cumDividendsPerShare: 0,
    marketShare: null,
  };
  company.equity = equityOf(company);
  company.lastAdjNI = C.costOfEquity * company.equity;
  return company;
}

export function sanitizeDecisions(raw, company) {
  const out = {};
  for (const def of DECISIONS) {
    let v = Number(raw?.[def.key]);
    if (!Number.isFinite(v)) v = def.default;
    v = clamp(v, def.min, def.max);
    out[def.key] = def.key === 'price' ? round2(v) : Math.round(v);
  }
  out.creditDays = clamp(Math.round(out.creditDays / 30) * 30, 0, 90);
  if (company) {
    out.production = Math.min(out.production, capacityOf(company));
    out.loan = Math.max(out.loan, -Math.round(company.debt));
    out.shares = clamp(
      out.shares,
      -Math.floor(company.shares * CONFIG.maxBuybackPct),
      Math.floor(company.shares * CONFIG.maxIssuePct),
    );
  }
  return out;
}

export function sanitizeMoves(raw, company, { allowIllegal = true, allowAcquisitions = true } = {}) {
  const out = defaultMoves();
  const bid = Math.round(Number(raw?.acquisitionBid));
  if (allowAcquisitions && Number.isFinite(bid) && bid > 0) {
    out.acquisitionBid = company ? Math.min(bid, Math.round(buyingPowerOf(company))) : bid;
  }
  if (allowIllegal) {
    const list = Array.isArray(raw?.illegal) ? raw.illegal : [];
    out.illegal = [...new Set(list.filter((k) => PRACTICE_KEYS.has(k)))];
    if (typeof raw?.reportTarget === 'string' && raw.reportTarget && raw.reportTarget !== company?.id) {
      out.reportTarget = raw.reportTarget.slice(0, 40);
    }
  }
  return out;
}

/** Probabilidade de uma prática ser descoberta neste período (sem contar denúncias). */
export function detectionRisk(company, key, activeNow) {
  const pr = practiceByKey[key];
  const st = company.illegal?.[key] ?? { streak: 0, exposure: 0 };
  let risk;
  if (activeNow) risk = pr.baseRisk + pr.streakRisk * st.streak;
  else if (st.exposure > 0) risk = pr.baseRisk * 0.4;
  else return 0;
  if (company.investigation > 0) risk *= 1.5;
  return Math.min(0.9, risk);
}

export function initialEnvironment() {
  return {
    economy: 1,
    demandMult: 1,
    materialMult: 1,
    interestRate: CONFIG.baseInterest,
    sentiment: 0,
    event: {
      title: 'Abertura do mercado',
      text: 'Todas as empresas começam iguais: mesmo caixa, mesma fábrica, mesmo preço de ação (R$ 10). Que vença a melhor gestão!',
    },
    acquisition: null,
  };
}

function generateTarget(rng, period, previousName) {
  const options = ACQUISITION_TARGETS.filter((x) => x.name !== previousName);
  const t = options[Math.floor(rng() * options.length)];
  const k = 0.8 + rng() * 0.45;
  const fixedAssets = Math.round((t.fixedAssets * k) / 1000) * 1000;
  const customers = Math.round((t.customers * k) / 50) * 50;
  const brand = Math.round((t.brand * k) / 1000) * 1000;
  const quality = Math.round((t.quality * k) / 1000) * 1000;
  // Valor de referência: ativos + ~70 R$ por cliente/período + metade da marca/qualidade.
  const fairValue = fixedAssets + customers * 70 + 0.5 * (brand + quality);
  const minBid = Math.max(fixedAssets, Math.round((fairValue * t.discount) / 10_000) * 10_000);
  return {
    id: `T${period}`,
    name: t.name,
    kind: t.kind,
    text: t.text,
    fixedAssets,
    capacity: Math.floor(fixedAssets / CONFIG.capitalPerUnit),
    customers,
    brand,
    quality,
    minBid,
  };
}

export function generateEnvironment(prev, rng, period = 2, { allowAcquisitions = true } = {}) {
  const economy = clamp(1 + 0.6 * (prev.economy - 1) + gaussian(rng) * 0.04, 0.8, 1.2);
  const ev = rng() < 0.45 ? EVENTS[Math.floor(rng() * EVENTS.length)] : null;
  const e = ev?.effects ?? {};
  const hasTarget = rng() < CONFIG.acquisitionChance;
  return {
    economy: round4(economy),
    demandMult: round4(economy * (1 + (e.demand || 0))),
    materialMult: round4(clamp(1 + 0.5 * (prev.materialMult - 1) + gaussian(rng) * 0.02 + (e.material || 0), 0.75, 1.5)),
    interestRate: round4(clamp(CONFIG.baseInterest + 0.6 * (prev.interestRate - CONFIG.baseInterest) + (e.interest || 0), 0.01, 0.07)),
    sentiment: e.sentiment || 0,
    event: ev ? { title: ev.title, text: ev.text } : null,
    acquisition: allowAcquisitions && hasTarget ? generateTarget(rng, period, prev.acquisition?.name) : null,
  };
}

function round4(x) {
  return Math.round(x * 10_000) / 10_000;
}

export function unitCostEstimate(units, salaryPct, materialMult, illegal = []) {
  const C = CONFIG;
  const salary = salaryPct / 100;
  const scale = Math.pow(Math.max(units, 1000) / 10_000, -0.05);
  const morale = 0.6 + 0.4 * salary;
  const labor = ((C.laborCost * salary) / morale) * (illegal.includes('informalLabor') ? 0.7 : 1);
  const material = C.materialCost * materialMult * scale - (illegal.includes('illegalDumping') ? 3 : 0);
  return material + labor;
}

/**
 * Simula um período contábil para todas as empresas que disputam o mesmo mercado.
 * @param movesById movimentos opcionais por empresa (aquisição, práticas ilegais, denúncia)
 * @param options.finalPeriod último período: auditoria de encerramento aumenta o risco de detecção
 * @param options.deterministic projeção: sem sorte/azar, sem detecção de práticas ilegais e sem leilão
 * @param options.cartels cartéis ativos: [{ id, members, delators, periods }]
 * @returns {{ companies: object[], reports: Record<string, object>, market: object }}
 */
export function simulatePeriod(companies, decisionsById, env, rng, period = 1, movesById = {}, { finalPeriod = false, deterministic = false, cartels = [] } = {}) {
  const C = CONFIG;
  const noise = deterministic ? () => 0 : () => gaussian(rng);
  const demandNoise = Math.exp(noise() * 0.03);
  const marketMood = noise() * 0.01 + (env.sentiment || 0);
  const ids = new Set(companies.map((c) => c.id));

  const ps = companies.map((c) => {
    const d = sanitizeDecisions(decisionsById[c.id], c);
    const mv = sanitizeMoves(movesById[c.id], c);
    if (mv.reportTarget && !ids.has(mv.reportTarget)) mv.reportTarget = null;
    const capacity = capacityOf(c);
    const falseAd = mv.illegal.includes('falseAdvertising');
    return {
      c,
      d,
      mv,
      capacity,
      produced: Math.min(d.production, capacity),
      salary: d.salary / 100,
      brand: c.brand * C.brandRetention + d.marketing * (falseAd ? 2 : 1),
      quality: c.quality * C.qualityRetention + d.rnd,
    };
  });
  const n = ps.length;

  // Práticas ativas neste período: as marcadas pela empresa + cartel, se ela estiver em um.
  const byId = Object.fromEntries(ps.map((p) => [p.c.id, p]));
  const groups = cartels
    .map((g) => ({ ...g, members: g.members.filter((id) => byId[id]) }))
    .filter((g) => g.members.length >= 2);
  for (const p of ps) p.active = [...p.mv.illegal];
  for (const g of groups) {
    for (const id of g.members) {
      byId[id].cartel = g;
      byId[id].active.push('cartel');
    }
  }

  // Espionagem: copia parte do P&D dos concorrentes.
  for (const p of ps) {
    p.stolen = 0;
    if (p.mv.illegal.includes('espionage') && n > 1) {
      p.stolen = (0.3 * sum(ps.filter((o) => o !== p), (o) => o.d.rnd)) / (n - 1);
      p.quality += p.stolen;
    }
  }

  // Denúncias e detecção das práticas ilegais.
  const reportsAgainst = Object.fromEntries(companies.map((c) => [c.id, []]));
  for (const p of ps) if (p.mv.reportTarget) reportsAgainst[p.mv.reportTarget].push(p.c.id);
  for (const p of ps) {
    p.caught = [];
    const keys = new Set([...p.active, ...Object.keys(p.c.illegal ?? {}).filter((k) => p.c.illegal[k].exposure > 0)]);
    for (const key of [...keys].sort()) {
      if (key === 'cartel' && p.cartel) continue; // cartel ativo é investigado em grupo, abaixo
      const active = p.active.includes(key);
      const risk = Math.min(0.95, detectionRisk(p.c, key, active)
        + C.reportDetectionBoost * reportsAgainst[p.c.id].length
        + (finalPeriod ? C.finalAuditRisk : 0));
      if (!deterministic && rng() < risk) p.caught.push(key);
    }
  }
  // Cartel: delação derruba o grupo na hora (delator ganha imunidade); senão o CADE investiga o grupo todo.
  const cartelResults = [];
  for (const g of groups) {
    const delators = (g.delators ?? []).filter((id) => g.members.includes(id));
    let exposed = delators.length > 0;
    if (!exposed && !deterministic) {
      const reports = sum(g.members, (id) => reportsAgainst[id].length);
      const investigated = g.members.some((id) => byId[id].c.investigation > 0);
      const risk = Math.min(0.95,
        (CARTEL_PRACTICE.baseRisk + CARTEL_PRACTICE.streakRisk * (g.periods || 0)) * (investigated ? 1.5 : 1)
        + C.reportDetectionBoost * reports + (finalPeriod ? C.finalAuditRisk : 0));
      exposed = rng() < risk;
    }
    if (exposed) {
      for (const id of g.members) {
        if (delators.includes(id)) byId[id].leniency = true;
        else byId[id].caught.push('cartel');
      }
    }
    cartelResults.push({ id: g.id, members: g.members, exposed, byDelation: delators.length > 0, delators });
  }
  const reportSucceeded = (p) => Boolean(ps.find((x) => x.c.id === p.mv.reportTarget)?.caught.length);
  // Denúncia caluniosa: o denunciado não praticava nada nem tinha ganhos ilícitos expostos.
  const isHonest = (p) => p.active.length === 0
    && !Object.values(p.c.illegal ?? {}).some((st) => st.exposure > 0);
  const falseReporters = Object.fromEntries(companies.map((c) => [c.id, []]));
  for (const p of ps) {
    const target = p.mv.reportTarget && ps.find((x) => x.c.id === p.mv.reportTarget);
    if (target && isHonest(target)) falseReporters[target.c.id].push(p.c.id);
  }

  // Leilão da empresa à venda: maior lance acima do mínimo leva (paga o próprio lance).
  let acquisition = null;
  const target = deterministic ? null : env.acquisition;
  if (target) {
    const bids = ps.filter((p) => p.mv.acquisitionBid >= target.minBid);
    if (bids.length) {
      const top = Math.max(...bids.map((p) => p.mv.acquisitionBid));
      const tied = bids.filter((p) => p.mv.acquisitionBid === top);
      const winner = tied[Math.floor(rng() * tied.length)];
      acquisition = { target, winnerId: winner.c.id, price: top, bidders: bids.length };
      winner.acquired = acquisition;
    } else {
      acquisition = { target, winnerId: null, price: 0, bidders: 0 };
    }
  }

  // 1) Mercado: atratividade relativa de cada empresa.
  const avgPrice = sum(ps, (p) => p.d.price) / n;
  const avgBrand = sum(ps, (p) => p.brand) / n;
  const avgQuality = sum(ps, (p) => p.quality) / n;

  for (const p of ps) {
    p.attract =
      Math.pow(p.d.price / avgPrice, -C.sharePriceElasticity) *
      Math.pow((p.brand + BRAND_SOFTENER) / (avgBrand + BRAND_SOFTENER), 0.4) *
      Math.pow((p.quality + QUALITY_SOFTENER) / (avgQuality + QUALITY_SOFTENER), 0.35) *
      Math.pow(p.salary, 0.45) *
      (1 + (0.04 * p.d.creditDays) / 30) *
      p.c.reputation;
  }
  const totalDemand =
    C.baseDemandPerCompany * n * env.demandMult * demandNoise *
    Math.pow(avgPrice / C.refPrice, -C.marketPriceElasticity) *
    Math.pow((avgBrand + BRAND_SOFTENER) / (BASE_BRAND + BRAND_SOFTENER), 0.1) *
    Math.pow((avgQuality + QUALITY_SOFTENER) / (BASE_QUALITY + QUALITY_SOFTENER), 0.08);

  const sumAttract = sum(ps, (p) => p.attract);
  for (const p of ps) {
    // Clientes herdados de aquisições formam uma base cativa (sensível ao preço e à reputação).
    p.captive = (p.c.acquiredCustomers || 0) * env.demandMult * demandNoise *
      Math.pow(p.d.price / avgPrice, -1.5) * p.c.reputation;
    p.demand = (totalDemand * p.attract) / sumAttract + p.captive;
    p.available = p.c.inventoryUnits + p.produced;
    p.sales = Math.min(p.demand, p.available);
  }
  // Metade dos clientes que não encontram produto compra de quem tem estoque.
  const pool = 0.5 * sum(ps, (p) => p.demand - p.sales);
  const takers = ps.filter((p) => p.available - p.sales > 0.5);
  const takersAttract = sum(takers, (p) => p.attract);
  if (pool > 0 && takersAttract > 0) {
    for (const t of takers) {
      const extra = Math.min(t.available - t.sales, (pool * t.attract) / takersAttract);
      t.sales += extra;
      t.demand += extra;
    }
  }
  for (const p of ps) {
    p.sales = Math.floor(p.sales + 1e-9);
    p.demand = Math.max(p.sales, Math.round(p.demand));
  }
  const totalSales = sum(ps, (p) => p.sales);

  // 2) Contabilidade de cada empresa.
  const reports = {};
  const next = ps.map((p) => {
    const { c, d, mv } = p;
    const t = C.taxRate;
    const equity0 = equityOf(c);

    // Financiamento no início do período.
    let loan = d.loan;
    if (loan > 0) loan = Math.max(0, Math.min(loan, creditLimitOf(c) - c.debt));
    else if (loan < 0) loan = -Math.min(-loan, c.debt, Math.max(0, c.cash));
    const issuedShares = Math.max(0, d.shares);
    const issueProceeds = issuedShares * c.price * (1 - C.issueDiscount);
    const debtForInterest = c.debt + loan;
    const interestRate = interestRateFor(debtForInterest, equity0 + issueProceeds, env.interestRate);

    // Produção e estoque (custo médio ponderado).
    const unitCost = unitCostEstimate(p.produced, d.salary, env.materialMult, mv.illegal);
    const legalUnitCost = unitCostEstimate(p.produced, d.salary, env.materialMult);
    const productionCost = p.produced * unitCost;
    const totalUnits = c.inventoryUnits + p.produced;
    const avgCost = totalUnits > 0 ? (c.inventoryValue + productionCost) / totalUnits : unitCost;
    const cogs = p.sales * avgCost;
    const endUnits = totalUnits - p.sales;
    const endInventoryValue = c.inventoryValue + productionCost - cogs;

    // Receita, prazo e inadimplência.
    const revenue = p.sales * d.price;
    const creditSales = (revenue * d.creditDays) / C.periodDays;
    const badDebt = (revenue * C.badDebtPer30Days * d.creditDays) / 30;
    const cashSales = revenue - creditSales;
    const newReceivables = creditSales - badDebt;
    const collections = c.receivables;

    // DRE.
    const admin = C.adminFixed + C.adminSalaryLinked * p.salary;
    const carrying = endUnits * C.inventoryCarryCost;
    const depreciation = c.fixedAssets * C.depreciationRate;
    const legal = mv.reportTarget ? C.reportCost : 0;
    const grossProfit = revenue - cogs;
    const ebit = grossProfit - d.marketing - d.rnd - admin - carrying - badDebt - depreciation - legal;
    const interest = debtForInterest * interestRate;
    const financialIncome = Math.max(0, c.cash) * env.interestRate * C.cashYieldShare;
    const ebt = ebit + financialIncome - interest;
    let lossCarryforward = c.lossCarryforward;
    let tax = 0;
    if (ebt > 0) {
      const taxable = Math.max(0, ebt - lossCarryforward);
      lossCarryforward = Math.max(0, lossCarryforward - ebt);
      tax = taxable * t;
    } else {
      lossCarryforward += -ebt;
    }

    // Ganhos ilícitos deste período (base para multas futuras).
    const gains = {};
    for (const key of p.active) {
      if (key === 'taxEvasion') gains[key] = tax;
      else if (key === 'informalLabor' || key === 'illegalDumping') {
        const laborOnly = key === 'informalLabor'
          ? unitCostEstimate(p.produced, d.salary, env.materialMult, ['informalLabor'])
          : unitCostEstimate(p.produced, d.salary, env.materialMult, ['illegalDumping']);
        gains[key] = p.produced * (legalUnitCost - laborOnly);
      } else if (key === 'falseAdvertising') gains[key] = 0.5 * d.marketing;
      else if (key === 'espionage') gains[key] = p.stolen;
      else if (key === 'accountingFraud') gains[key] = C.accountingFraudBoost * revenue;
      else if (key === 'cartel') gains[key] = C.cartelGainShare * revenue;
    }
    if (mv.illegal.includes('taxEvasion')) tax = 0;

    // Multas pelas práticas descobertas e recompensa por denúncia.
    const illegal = {};
    for (const [key, st] of Object.entries(c.illegal ?? {})) illegal[key] = { ...st };
    for (const key of p.active) {
      const st = illegal[key] ?? { streak: 0, exposure: 0 };
      illegal[key] = { streak: st.streak + 1, exposure: st.exposure + gains[key] };
    }
    for (const key of Object.keys(illegal)) if (!p.active.includes(key)) illegal[key].streak = 0;
    // Delação premiada: o delator fica livre da punição pelo cartel.
    if (p.leniency) illegal.cartel = { streak: 0, exposure: 0 };
    const scandals = [];
    let fines = 0;
    let shock = 0;
    let reputationHit = 0;
    let brandAfter = p.brand;
    for (const key of p.caught) {
      const pr = practiceByKey[key];
      const repeatOffender = (c.convictions || 0) + scandals.length > 0;
      const fine = (C.fineMultiplier * illegal[key].exposure + C.fixedFine) * (repeatOffender ? C.repeatOffenderMultiplier : 1);
      fines += fine;
      shock += pr.shock;
      reputationHit += pr.reputationHit;
      if (pr.brandHit) brandAfter *= 1 - pr.brandHit;
      scandals.push({
        key, label: pr.label, fine, repeatOffender, reported: reportsAgainst[c.id].length > 0,
        byDelation: key === 'cartel' && Boolean(p.cartel && cartelResults.find((r) => r.id === p.cartel.id)?.byDelation),
      });
      illegal[key] = { streak: 0, exposure: 0 };
    }
    const reward = mv.reportTarget && reportSucceeded(p) ? C.reportReward : 0;
    const falseReport = Boolean(mv.reportTarget && falseReporters[mv.reportTarget]?.includes(c.id));
    const slanderPaid = falseReport ? C.falseReportIndemnity : 0;
    const compensation = falseReporters[c.id].length * C.falseReportIndemnity;
    const investigation = p.caught.length ? C.investigationPeriods : Math.max(0, (c.investigation || 0) - 1);
    const convictions = (c.convictions || 0) + p.caught.length;
    // Empresa com histórico de condenações carrega um desconto permanente na bolsa.
    const governanceMult = Math.max(0.85, 1 - C.governanceDiscount * convictions);

    // Caixa.
    const operatingBeforeFee =
      collections + cashSales + financialIncome + reward + compensation - slanderPaid
      - productionCost - d.marketing - d.rnd - admin - carrying
      - interest - tax - legal - fines;
    const acquisitionPrice = p.acquired ? p.acquired.price : 0;
    let cash = c.cash + loan + issueProceeds + operatingBeforeFee - d.capex - acquisitionPrice;
    const canPayDividends = equity0 + ebt - tax - fines > 0;
    const dividends = canPayDividends ? Math.min(d.dividends, Math.max(0, cash)) : 0;
    cash -= dividends;
    let buybackShares = 0;
    let buybackCost = 0;
    if (d.shares < 0) {
      const px = c.price * (1 + C.buybackPremium);
      buybackShares = Math.min(-d.shares, Math.floor(Math.max(0, cash) / px));
      buybackCost = buybackShares * px;
      cash -= buybackCost;
    }
    let emergencyLoan = 0;
    let emergencyFee = 0;
    if (cash < 0) {
      emergencyLoan = -cash / (1 - C.emergencyFeeRate);
      emergencyFee = emergencyLoan * C.emergencyFeeRate;
      cash = 0;
    }
    const netIncome = ebt - tax - fines + reward + compensation - slanderPaid - emergencyFee;

    // Aquisição: ativos entram pelo valor justo da fábrica; o excedente pago vira ágio.
    const acquiredFA = p.acquired ? p.acquired.target.fixedAssets : 0;
    const goodwill = (c.goodwill || 0) + (p.acquired ? acquisitionPrice - acquiredFA : 0);
    const debt = c.debt + loan + emergencyLoan;
    const fixedAssets = c.fixedAssets - depreciation + d.capex + acquiredFA;
    const sharesForDividend = c.shares + issuedShares;
    const shares = sharesForDividend - buybackShares;
    const equity = equity0 + netIncome - dividends + issueProceeds - buybackCost;
    const dividendsPerShare = dividends / sharesForDividend;

    // Reputação: faltar produto irrita os clientes; escândalos também.
    const unmet = p.demand - p.sales;
    const unmetFrac = p.demand > 0 ? unmet / p.demand : 0;
    let reputation = unmetFrac > 0.05
      ? Math.max(0.75, c.reputation - unmetFrac * 0.4)
      : Math.min(1, c.reputation + 0.05);
    reputation = Math.max(0.6, reputation - reputationHit - (falseReport ? C.falseReportReputationHit : 0));

    // Ação: lucro econômico (marca e P&D parcialmente tratados como investimento),
    // retorno sobre o patrimônio vs. custo de capital, crescimento e humor do mercado.
    const intangibleAmortization =
      (1 - C.brandRetention) * c.brand + (1 - C.qualityRetention) * c.quality;
    const fraudBoost = mv.illegal.includes('accountingFraud') && !p.caught.includes('accountingFraud')
      ? C.accountingFraudBoost * revenue : 0;
    // Multas e recompensas são eventos únicos: o mercado não as projeta para o futuro.
    // Já o ganho de uma prática descoberta deixa de existir, então sai do lucro considerado.
    const exposedGains = sum(p.caught, (key) => gains[key] ?? 0);
    const adjNI = netIncome + fines - reward - compensation + slanderPaid + fraudBoost - exposedGains
      + 0.5 * (1 - t) * (d.marketing + d.rnd - intangibleAmortization);
    const smoothNI = 0.6 * adjNI + 0.4 * c.lastAdjNI;
    const bvps = equity / shares;
    const growth = clamp(revenue / Math.max(c.lastRevenue, 1) - 1, -0.3, 0.3);
    let roe = null;
    let targetPrice;
    if (equity <= 0) {
      targetPrice = 0.5;
    } else {
      const ke = C.costOfEquity + 0.01 * Math.max(0, debt / equity - 1);
      roe = smoothNI / equity;
      const factor = clamp(1 + (roe - ke) * C.valuationMultiplier, 0.25, 4) * (1 + 0.3 * growth);
      targetPrice = bvps * factor;
    }
    const scandalMult = Math.max(0.4, 1 - shock);
    const price = round2(Math.max(0.1,
      (0.6 * targetPrice * governanceMult + 0.4 * c.price) * Math.exp(noise() * 0.03 + marketMood) * scandalMult));
    const cumDividendsPerShare = c.cumDividendsPerShare + dividendsPerShare;
    const tsr = (price + cumDividendsPerShare) / C.initialPrice - 1;

    const company = {
      ...c,
      cash,
      receivables: newReceivables,
      inventoryUnits: endUnits,
      inventoryValue: endInventoryValue,
      fixedAssets,
      goodwill,
      debt,
      shares,
      price,
      brand: brandAfter + (p.acquired ? p.acquired.target.brand : 0),
      quality: p.quality + (p.acquired ? p.acquired.target.quality : 0),
      reputation,
      acquiredCustomers: (c.acquiredCustomers || 0) * (1 - C.customerChurn) + (p.acquired ? p.acquired.target.customers : 0),
      acquisitions: p.acquired ? [...(c.acquisitions ?? []), { period, name: p.acquired.target.name, price: acquisitionPrice }] : (c.acquisitions ?? []),
      illegal,
      investigation,
      convictions,
      lossCarryforward,
      lastAdjNI: adjNI,
      lastRevenue: revenue,
      cumDividendsPerShare,
      marketShare: totalSales > 0 ? p.sales / totalSales : 0,
      equity,
    };

    const totalAssets = cash + newReceivables + endInventoryValue + fixedAssets + goodwill;
    const operating = operatingBeforeFee - emergencyFee;
    reports[c.id] = {
      period,
      decisions: d,
      appliedFinance: { loan, issuedShares, issueProceeds, buybackShares, buybackCost, dividends, emergencyLoan, interestRate },
      operations: {
        capacity: p.capacity,
        produced: p.produced,
        utilization: p.capacity > 0 ? p.produced / p.capacity : 0,
        unitCost,
        demand: p.demand,
        captiveDemand: Math.round(p.captive),
        sales: p.sales,
        unmet,
        inventoryUnits: endUnits,
        marketShare: company.marketShare,
        reputation,
        brandIndex: company.brand / BASE_BRAND,
        qualityIndex: company.quality / BASE_QUALITY,
        nextCapacity: capacityOf(company),
      },
      income: {
        revenue, cogs, grossProfit, marketing: d.marketing, rnd: d.rnd, admin, carrying, badDebt,
        depreciation, legal, ebit, financialIncome, interest, ebt, tax, fines, reward, compensation, slanderPaid,
        emergencyFee, netIncome,
      },
      balance: {
        cash, receivables: newReceivables, inventory: endInventoryValue, fixedAssets, goodwill, totalAssets,
        debt, equity, totalLiabilitiesAndEquity: debt + equity,
      },
      cashflow: {
        begin: c.cash,
        collections,
        cashSales,
        operating,
        investing: -d.capex - acquisitionPrice,
        financing: loan + issueProceeds - dividends - buybackCost + emergencyLoan,
        emergencyLoan,
        end: cash,
      },
      stock: {
        prevPrice: c.price,
        price,
        change: price / c.price - 1,
        shares,
        eps: netIncome / shares,
        bvps,
        dividendsPerShare,
        cumDividendsPerShare,
        tsr,
        marketCap: price * shares,
      },
      indicators: {
        grossMargin: revenue > 0 ? grossProfit / revenue : 0,
        netMargin: revenue > 0 ? netIncome / revenue : 0,
        roe: equity0 > 0 ? netIncome / equity0 : null,
        debtToEquity: equity > 0 ? debt / equity : null,
        economicRoe: roe,
      },
      // Público: o que vira notícia.
      events: {
        acquired: p.acquired ? { name: p.acquired.target.name, price: acquisitionPrice } : null,
        scandals,
        reportsReceived: reportsAgainst[c.id].length,
        // Denúncias caluniosas são públicas: quem acusou uma empresa honesta é exposto.
        falseAccusers: falseReporters[c.id],
        falseAccusationAgainst: falseReport ? mv.reportTarget : null,
        leniency: Boolean(p.leniency), // delatou o próprio cartel e ganhou imunidade
        convictions,
      },
      // Privado: só a própria empresa enxerga.
      private: {
        moves: mv,
        gains,
        reward,
        illegal,
        investigation,
      },
    };
    return company;
  });

  return {
    companies: next,
    reports,
    market: {
      totalDemand: Math.round(totalDemand + sum(ps, (p) => p.captive)),
      totalSales,
      avgPrice,
      realizedDemandMult: env.demandMult * demandNoise,
      acquisition: acquisition && {
        targetId: acquisition.target.id,
        name: acquisition.target.name,
        winnerId: acquisition.winnerId,
        price: acquisition.price,
        bidders: acquisition.bidders,
      },
      // Só cartéis desmantelados viram públicos.
      cartels: cartelResults.filter((r) => r.exposed),
    },
  };
}

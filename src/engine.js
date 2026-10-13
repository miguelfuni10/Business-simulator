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

export const equityOf = (c) => c.cash + c.receivables + c.inventoryValue + c.fixedAssets - c.debt;

export const creditLimitOf = (c) => Math.max(CONFIG.minCreditLimit, CONFIG.creditLimitToEquity * equityOf(c));

export function interestRateFor(debt, equity, baseRate) {
  const leverage = equity > 0 ? debt / equity : Infinity;
  return baseRate + Math.min(0.05, 0.01 * Math.max(0, leverage - 0.5));
}

export function defaultDecisions() {
  return Object.fromEntries(DECISIONS.map((d) => [d.key, d.default]));
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
    debt: C.initialDebt,
    shares: C.initialShares,
    price: C.initialPrice,
    brand: BASE_BRAND,
    quality: BASE_QUALITY,
    reputation: 1,
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
  };
}

export function generateEnvironment(prev, rng) {
  const economy = clamp(1 + 0.6 * (prev.economy - 1) + gaussian(rng) * 0.04, 0.8, 1.2);
  const ev = rng() < 0.45 ? EVENTS[Math.floor(rng() * EVENTS.length)] : null;
  const e = ev?.effects ?? {};
  return {
    economy: round4(economy),
    demandMult: round4(economy * (1 + (e.demand || 0))),
    materialMult: round4(clamp(1 + 0.5 * (prev.materialMult - 1) + gaussian(rng) * 0.02 + (e.material || 0), 0.75, 1.5)),
    interestRate: round4(clamp(CONFIG.baseInterest + 0.6 * (prev.interestRate - CONFIG.baseInterest) + (e.interest || 0), 0.01, 0.07)),
    sentiment: e.sentiment || 0,
    event: ev ? { title: ev.title, text: ev.text } : null,
  };
}

function round4(x) {
  return Math.round(x * 10_000) / 10_000;
}

export function unitCostEstimate(units, salaryPct, materialMult) {
  const C = CONFIG;
  const salary = salaryPct / 100;
  const scale = Math.pow(Math.max(units, 1000) / 10_000, -0.05);
  const morale = 0.6 + 0.4 * salary;
  return C.materialCost * materialMult * scale + (C.laborCost * salary) / morale;
}

/**
 * Simula um período contábil para todas as empresas que disputam o mesmo mercado.
 * @returns {{ companies: object[], reports: Record<string, object>, market: object }}
 */
export function simulatePeriod(companies, decisionsById, env, rng, period = 1) {
  const C = CONFIG;
  const demandNoise = Math.exp(gaussian(rng) * 0.03);
  const marketMood = gaussian(rng) * 0.01 + (env.sentiment || 0);

  // 1) Mercado: atratividade relativa de cada empresa.
  const ps = companies.map((c) => {
    const d = sanitizeDecisions(decisionsById[c.id], c);
    const capacity = capacityOf(c);
    return {
      c,
      d,
      capacity,
      produced: Math.min(d.production, capacity),
      salary: d.salary / 100,
      brand: c.brand * C.brandRetention + d.marketing,
      quality: c.quality * C.qualityRetention + d.rnd,
    };
  });
  const n = ps.length;
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
    p.demand = (totalDemand * p.attract) / sumAttract;
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
    const { c, d } = p;
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
    const unitCost = unitCostEstimate(p.produced, d.salary, env.materialMult);
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
    const grossProfit = revenue - cogs;
    const ebit = grossProfit - d.marketing - d.rnd - admin - carrying - badDebt - depreciation;
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

    // Caixa.
    const operatingBeforeFee =
      collections + cashSales + financialIncome - productionCost - d.marketing - d.rnd - admin - carrying - interest - tax;
    let cash = c.cash + loan + issueProceeds + operatingBeforeFee - d.capex;
    const canPayDividends = equity0 + ebt - tax > 0;
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
    const netIncome = ebt - tax - emergencyFee;

    const debt = c.debt + loan + emergencyLoan;
    const fixedAssets = c.fixedAssets - depreciation + d.capex;
    const sharesForDividend = c.shares + issuedShares;
    const shares = sharesForDividend - buybackShares;
    const equity = equity0 + netIncome - dividends + issueProceeds - buybackCost;
    const dividendsPerShare = dividends / sharesForDividend;

    // Reputação: faltar produto irrita os clientes.
    const unmet = p.demand - p.sales;
    const unmetFrac = p.demand > 0 ? unmet / p.demand : 0;
    const reputation = unmetFrac > 0.05
      ? Math.max(0.75, c.reputation - unmetFrac * 0.4)
      : Math.min(1, c.reputation + 0.05);

    // Ação: lucro econômico (marca e P&D parcialmente tratados como investimento),
    // retorno sobre o patrimônio vs. custo de capital, crescimento e humor do mercado.
    const intangibleAmortization =
      (1 - C.brandRetention) * c.brand + (1 - C.qualityRetention) * c.quality;
    const adjNI = netIncome + 0.5 * (1 - t) * (d.marketing + d.rnd - intangibleAmortization);
    const smoothNI = 0.6 * adjNI + 0.4 * c.lastAdjNI;
    const bvps = equity / shares;
    const growth = clamp(revenue / Math.max(c.lastRevenue, 1) - 1, -0.3, 0.3);
    let roe = null;
    let target;
    if (equity <= 0) {
      target = 0.5;
    } else {
      const ke = C.costOfEquity + 0.01 * Math.max(0, debt / equity - 1);
      roe = smoothNI / equity;
      const factor = clamp(1 + (roe - ke) * C.valuationMultiplier, 0.25, 4) * (1 + 0.3 * growth);
      target = bvps * factor;
    }
    const price = round2(Math.max(0.1, (0.6 * target + 0.4 * c.price) * Math.exp(gaussian(rng) * 0.03 + marketMood)));
    const cumDividendsPerShare = c.cumDividendsPerShare + dividendsPerShare;
    const tsr = (price + cumDividendsPerShare) / C.initialPrice - 1;

    const company = {
      ...c,
      cash,
      receivables: newReceivables,
      inventoryUnits: endUnits,
      inventoryValue: endInventoryValue,
      fixedAssets,
      debt,
      shares,
      price,
      brand: p.brand,
      quality: p.quality,
      reputation,
      lossCarryforward,
      lastAdjNI: adjNI,
      lastRevenue: revenue,
      cumDividendsPerShare,
      marketShare: totalSales > 0 ? p.sales / totalSales : 0,
      equity,
    };

    const totalAssets = cash + newReceivables + endInventoryValue + fixedAssets;
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
        sales: p.sales,
        unmet,
        inventoryUnits: endUnits,
        marketShare: company.marketShare,
        reputation,
        brandIndex: p.brand / BASE_BRAND,
        qualityIndex: p.quality / BASE_QUALITY,
        nextCapacity: capacityOf(company),
      },
      income: {
        revenue, cogs, grossProfit, marketing: d.marketing, rnd: d.rnd, admin, carrying, badDebt,
        depreciation, ebit, financialIncome, interest, ebt, tax, emergencyFee, netIncome,
      },
      balance: {
        cash, receivables: newReceivables, inventory: endInventoryValue, fixedAssets, totalAssets,
        debt, equity, totalLiabilitiesAndEquity: debt + equity,
      },
      cashflow: {
        begin: c.cash,
        collections,
        cashSales,
        operating,
        investing: -d.capex,
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
    };
    return company;
  });

  return {
    companies: next,
    reports,
    market: {
      totalDemand: Math.round(totalDemand),
      totalSales,
      avgPrice,
      realizedDemandMult: env.demandMult * demandNoise,
    },
  };
}

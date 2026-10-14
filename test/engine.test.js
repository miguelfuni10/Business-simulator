import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG, DECISIONS, ILLEGAL_PRACTICES, capacityOf, createCompany, createRng, defaultDecisions, equityOf, generateEnvironment,
  initialEnvironment, periodSeed, sanitizeDecisions, simulatePeriod,
} from '../src/engine.js';

function randomDecisions(rng) {
  const d = {};
  for (const def of DECISIONS) {
    const span = Math.min(def.max, 400_000) - Math.max(def.min, -400_000);
    d[def.key] = Math.max(def.min, -400_000) + rng() * span;
  }
  d.price = 20 + rng() * 100;
  d.production = rng() * 15_000;
  d.salary = 70 + rng() * 80;
  return d;
}

function randomMoves(rng, env) {
  const keys = ILLEGAL_PRACTICES.map((x) => x.key);
  return {
    acquisitionBid: env.acquisition && rng() < 0.5 ? env.acquisition.minBid * (1 + rng()) : 0,
    illegal: keys.filter(() => rng() < 0.25),
    reportTarget: rng() < 0.3 ? ['a', 'b', 'c', 'd'][Math.floor(rng() * 4)] : null,
  };
}

function play(periods, seed, decide, move = () => ({})) {
  let companies = ['a', 'b', 'c', 'd'].map((id) => createCompany(id, id.toUpperCase()));
  let env = initialEnvironment();
  const rng = createRng(seed);
  const all = [];
  for (let p = 1; p <= periods; p++) {
    const decisions = Object.fromEntries(companies.map((c) => [c.id, decide(c, rng, p)]));
    const moves = Object.fromEntries(companies.map((c) => [c.id, move(c, rng, env, p)]));
    const res = simulatePeriod(companies, decisions, env, createRng(periodSeed(seed, p, 1)), p, moves, {
      finalPeriod: p === periods,
    });
    all.push({ ...res, env });
    companies = res.companies;
    env = generateEnvironment(env, createRng(periodSeed(seed, p + 1, 2)), p + 1);
  }
  return { companies, all };
}

test('empresa inicial tem balanço fechado e valor patrimonial de R$ 10 por ação', () => {
  const c = createCompany('x', 'X');
  assert.equal(equityOf(c), 1_000_000);
  assert.equal(c.equity / c.shares, CONFIG.initialPrice);
  assert.equal(capacityOf(c), 12_000);
});

test('ativo = passivo + PL e caixa fecha em todos os períodos, mesmo com decisões malucas', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const { all } = play(12, seed, (c, rng) => randomDecisions(rng), (c, rng, env) => randomMoves(rng, env));
    for (const res of all) {
      for (const r of Object.values(res.reports)) {
        const b = r.balance;
        assert.ok(Math.abs(b.totalAssets - b.totalLiabilitiesAndEquity) < 1e-3, `balanço não fecha: ${b.totalAssets} vs ${b.totalLiabilitiesAndEquity}`);
        const cf = r.cashflow;
        assert.ok(Math.abs(cf.begin + cf.operating + cf.investing + cf.financing - cf.end) < 1e-3, 'fluxo de caixa não fecha');
        assert.ok(b.cash >= 0, 'caixa negativo');
        assert.ok(r.operations.sales <= r.operations.demand, 'vendeu mais que a demanda');
        assert.ok(r.operations.inventoryUnits >= 0, 'estoque negativo');
        assert.ok(r.stock.price > 0 && Number.isFinite(r.stock.price), 'cotação inválida');
        const inc = r.income;
        assert.ok(Math.abs(inc.revenue - inc.cogs - inc.marketing - inc.rnd - inc.admin - inc.carrying - inc.badDebt
          - inc.depreciation - inc.legal + inc.financialIncome - inc.interest - inc.tax - inc.fines + inc.reward
          + inc.compensation - inc.slanderPaid - inc.emergencyFee - inc.netIncome) < 1e-3, 'DRE não fecha');
      }
    }
  }
});

test('mesma semente e decisões produzem o mesmo resultado', () => {
  const a = play(8, 42, () => defaultDecisions());
  const b = play(8, 42, () => defaultDecisions());
  assert.deepEqual(a.companies, b.companies);
});

test('decisões padrão mantêm a empresa saudável', () => {
  const { companies } = play(10, 7, () => defaultDecisions());
  for (const c of companies) {
    assert.ok(c.price > 6 && c.price < 16, `cotação fora do esperado: ${c.price}`);
    assert.ok(c.cash > 0);
  }
});

test('preço muito menor que o dos concorrentes conquista participação', () => {
  const { all } = play(1, 3, (c) => ({ ...defaultDecisions(), price: c.id === 'a' ? 50 : 62 }));
  const reports = all[0].reports;
  assert.ok(reports.a.operations.marketShare > reports.b.operations.marketShare);
});

test('sanitizeDecisions limita produção, recompra e prazo', () => {
  const c = createCompany('x', 'X');
  const d = sanitizeDecisions({ production: 99_999, shares: -50_000, creditDays: 47, price: 'abc', loan: -9e9 }, c);
  assert.equal(d.production, capacityOf(c));
  assert.equal(d.shares, -10_000);
  assert.equal(d.creditDays, 60);
  assert.equal(d.price, 60);
  assert.equal(d.loan, -CONFIG.initialDebt);
});

test('falta de caixa gera empréstimo emergencial com multa', () => {
  const { all } = play(1, 5, (c) => ({ ...defaultDecisions(), capex: c.id === 'a' ? 2_000_000 : 42_000 }));
  const r = all[0].reports.a;
  assert.ok(r.cashflow.emergencyLoan > 0);
  assert.ok(r.income.emergencyFee > 0);
  assert.equal(r.balance.cash, 0);
});

test('leilão: maior lance acima do mínimo leva a empresa, paga o lance e registra ágio', () => {
  const companies = ['a', 'b', 'c'].map((id) => createCompany(id, id));
  const env = generateEnvironment(initialEnvironment(), createRng(1), 2);
  env.acquisition = {
    id: 'T2', name: 'Alvo', kind: 'Clientes', text: '', fixedAssets: 140_000, capacity: 2000,
    customers: 2_000, brand: 50_000, quality: 0, minBid: 300_000,
  };
  const d = defaultDecisions();
  const res = simulatePeriod(companies, { a: d, b: d, c: d }, env, createRng(9), 2, {
    a: { acquisitionBid: 350_000 },
    b: { acquisitionBid: 420_000 },
    c: { acquisitionBid: 250_000 }, // abaixo do mínimo
  });
  assert.equal(res.market.acquisition.winnerId, 'b');
  assert.equal(res.market.acquisition.price, 420_000);
  assert.equal(res.market.acquisition.bidders, 2);
  const b = res.companies.find((c) => c.id === 'b');
  assert.equal(b.goodwill, 280_000);
  assert.equal(b.acquiredCustomers, 2_000);
  assert.equal(res.reports.b.cashflow.investing, -42_000 - 420_000);
  assert.equal(res.reports.a.events.acquired, null);
});

test('clientes herdados aumentam a demanda de quem comprou', () => {
  const companies = ['a', 'b'].map((id) => createCompany(id, id));
  companies[0].acquiredCustomers = 3_000;
  const d = defaultDecisions();
  const res = simulatePeriod(companies, { a: d, b: d }, initialEnvironment(), createRng(4), 1);
  assert.ok(res.reports.a.operations.captiveDemand > 2_500);
  assert.ok(res.reports.a.operations.demand > res.reports.b.operations.demand + 2_000);
});

test('práticas ilegais dão ganho, acumulam exposição e geram multa e queda da ação quando descobertas', () => {
  let caughtSomewhere = false;
  for (let seed = 1; seed <= 40 && !caughtSomewhere; seed++) {
    const { all } = play(8, seed, () => defaultDecisions(), (c) => (c.id === 'a' ? { illegal: ['taxEvasion', 'informalLabor'] } : {}));
    for (const res of all) {
      const ra = res.reports.a;
      if (ra.events.scandals.length) {
        caughtSomewhere = true;
        assert.ok(ra.income.fines >= CONFIG.fixedFine);
        for (const s of ra.events.scandals) assert.equal(ra.private.illegal[s.key].exposure, 0);
      } else {
        assert.equal(ra.income.tax, 0, 'sonegação zera o imposto');
        assert.ok(ra.operations.unitCost < res.reports.b.operations.unitCost, 'trabalho informal barateia a produção');
        assert.ok(ra.private.illegal.taxEvasion.exposure >= 0);
      }
    }
  }
  assert.ok(caughtSomewhere, 'em 40 partidas alguém deveria ter sido pego');
});

test('denúncia contra quem trapaceia aumenta a chance de punição e rende recompensa', () => {
  let caughtReported = 0;
  let caughtAlone = 0;
  let rewards = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const companies = ['a', 'b'].map((id) => createCompany(id, id));
    const d = defaultDecisions();
    const env = initialEnvironment();
    const reported = simulatePeriod(companies, { a: d, b: d }, env, createRng(seed), 1, {
      a: { illegal: ['illegalDumping'] }, b: { reportTarget: 'a' },
    });
    const alone = simulatePeriod(companies, { a: d, b: d }, env, createRng(seed), 1, {
      a: { illegal: ['illegalDumping'] },
    });
    if (reported.reports.a.events.scandals.length) caughtReported++;
    if (alone.reports.a.events.scandals.length) caughtAlone++;
    if (reported.reports.b.income.reward > 0) {
      rewards++;
      assert.equal(reported.reports.a.events.scandals[0].reported, true);
    }
    assert.equal(reported.reports.b.income.legal, CONFIG.reportCost);
  }
  assert.ok(caughtReported > caughtAlone * 2, `${caughtReported} vs ${caughtAlone}`);
  assert.equal(rewards, caughtReported);
});

test('denúncia contra empresa honesta é caluniosa: denunciante indeniza, perde reputação e é exposto', () => {
  const companies = ['a', 'b'].map((id) => createCompany(id, id));
  const d = defaultDecisions();
  for (let seed = 1; seed <= 50; seed++) {
    const res = simulatePeriod(companies, { a: d, b: d }, initialEnvironment(), createRng(seed), 1, { b: { reportTarget: 'a' } });
    const { a, b } = res.reports;
    assert.equal(a.events.scandals.length, 0);
    assert.equal(a.events.reportsReceived, 1);
    assert.deepEqual(a.events.falseAccusers, ['b']);
    assert.equal(b.events.falseAccusationAgainst, 'a');
    assert.equal(a.income.compensation, CONFIG.falseReportIndemnity);
    assert.equal(b.income.slanderPaid, CONFIG.falseReportIndemnity);
    assert.equal(b.income.reward, 0);
    assert.ok(b.operations.reputation < a.operations.reputation);
  }
});

test('denúncia contra quem trapaceia (mas escapou) só é arquivada, sem calúnia', () => {
  const companies = ['a', 'b'].map((id) => createCompany(id, id));
  const d = defaultDecisions();
  let archived = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const res = simulatePeriod(companies, { a: d, b: d }, initialEnvironment(), createRng(seed), 1, {
      a: { illegal: ['taxEvasion'] }, b: { reportTarget: 'a' },
    });
    const { a, b } = res.reports;
    assert.deepEqual(a.events.falseAccusers, []);
    assert.equal(b.income.slanderPaid, 0);
    if (!a.events.scandals.length) archived++;
  }
  assert.ok(archived > 0);
});

test('balanço continua fechando com cartel, delação e multas em grupo', () => {
  for (let seed = 1; seed <= 20; seed++) {
    let companies = ['a', 'b', 'c'].map((id) => createCompany(id, id));
    let env = initialEnvironment();
    const rng = createRng(seed);
    for (let p = 1; p <= 10; p++) {
      const decisions = Object.fromEntries(companies.map((c) => [c.id, randomDecisions(rng)]));
      const cartels = [{ id: 'k', members: ['a', 'b'], periods: p - 1, delators: rng() < 0.15 ? ['b'] : [] }];
      const res = simulatePeriod(companies, decisions, env, createRng(periodSeed(seed, p, 1)), p, {}, { cartels });
      for (const r of Object.values(res.reports)) {
        assert.ok(Math.abs(r.balance.totalAssets - r.balance.totalLiabilitiesAndEquity) < 1e-3);
      }
      const exposed = res.market.cartels[0];
      if (exposed?.byDelation) {
        assert.equal(res.reports.b.events.leniency, true);
        assert.ok(res.reports.a.events.scandals.some((s) => s.key === 'cartel'));
        assert.ok(!res.reports.b.events.scandals.some((s) => s.key === 'cartel'));
      }
      assert.ok(!res.reports.c.events.scandals.some((s) => s.key === 'cartel'), 'quem está fora não é punido');
      companies = res.companies;
      env = generateEnvironment(env, createRng(periodSeed(seed, p + 1, 2)), p + 1);
    }
  }
});

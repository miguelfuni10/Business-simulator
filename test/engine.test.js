import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG, DECISIONS, capacityOf, createCompany, createRng, defaultDecisions, equityOf, generateEnvironment,
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

function play(periods, seed, decide) {
  let companies = ['a', 'b', 'c', 'd'].map((id) => createCompany(id, id.toUpperCase()));
  let env = initialEnvironment();
  const rng = createRng(seed);
  const all = [];
  for (let p = 1; p <= periods; p++) {
    const decisions = Object.fromEntries(companies.map((c) => [c.id, decide(c, rng, p)]));
    const res = simulatePeriod(companies, decisions, env, createRng(periodSeed(seed, p, 1)), p);
    all.push(res);
    companies = res.companies;
    env = generateEnvironment(env, createRng(periodSeed(seed, p + 1, 2)));
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
    const { all } = play(12, seed, (c, rng) => randomDecisions(rng));
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
          - inc.depreciation + inc.financialIncome - inc.interest - inc.tax - inc.emergencyFee - inc.netIncome) < 1e-3, 'DRE não fecha');
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

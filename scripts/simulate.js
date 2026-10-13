// Roda várias partidas só com bots para checar o balanceamento do jogo.
// Uso: node scripts/simulate.js [partidas] [períodos]
import { createCompany, createRng, defaultDecisions, generateEnvironment, initialEnvironment, periodSeed, simulatePeriod } from '../src/engine.js';
import { BOT_PROFILES, botDecisions } from '../src/bots.js';

const games = Number(process.argv[2] ?? 200);
const periods = Number(process.argv[3] ?? 10);
const players = [...Object.keys(BOT_PROFILES), 'padrao'];
const tsr = Object.fromEntries(players.map((p) => [p, []]));
const wins = Object.fromEntries(players.map((p) => [p, 0]));
let emergencies = 0;

for (let g = 0; g < games; g++) {
  const seed = 1000 + g;
  let companies = players.map((p) => createCompany(p, p));
  let env = initialEnvironment();
  const last = {};
  for (let period = 1; period <= periods; period++) {
    const botRng = createRng(periodSeed(seed, period, 3));
    const decisions = {};
    for (const c of companies) {
      decisions[c.id] = c.id === 'padrao' ? defaultDecisions() : botDecisions(c, env, last[c.id], c.id, botRng);
    }
    const res = simulatePeriod(companies, decisions, env, createRng(periodSeed(seed, period, 1)), period);
    companies = res.companies;
    for (const [id, r] of Object.entries(res.reports)) {
      last[id] = r;
      if (r.cashflow.emergencyLoan > 0) emergencies++;
    }
    env = generateEnvironment(env, createRng(periodSeed(seed, period + 1, 2)));
  }
  let best = null;
  for (const id of players) {
    const r = last[id];
    tsr[id].push(r.stock.tsr);
    if (!best || r.stock.tsr > last[best].stock.tsr) best = id;
  }
  wins[best]++;
}

const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
console.log(`${games} partidas × ${periods} períodos`);
for (const id of players) {
  const sorted = [...tsr[id]].sort((a, b) => a - b);
  console.log(
    `${id.padEnd(13)} TSR médio ${(avg(tsr[id]) * 100).toFixed(1).padStart(6)}%  ` +
    `mín ${(sorted[0] * 100).toFixed(1).padStart(6)}%  máx ${(sorted.at(-1) * 100).toFixed(1).padStart(6)}%  vitórias ${wins[id]}`,
  );
}
console.log(`empréstimos emergenciais: ${emergencies}`);
